(function () {
    "use strict";

    const THREE_VERSION_PATH = "/static/vendor/three/0.164.1/";
    const instances = new Set();
    let modulesPromise = null;

    function getJsonScriptData(id, fallbackValue) {
        const element = document.getElementById(id);
        if (!element) {
            return fallbackValue;
        }
        try {
            return JSON.parse(element.textContent || "null") || fallbackValue;
        } catch (error) {
            return fallbackValue;
        }
    }

    const i18n = getJsonScriptData("handrive-i18n", {});

    function t(key, fallbackValue) {
        if (Object.prototype.hasOwnProperty.call(i18n, key) && typeof i18n[key] === "string") {
            return i18n[key];
        }
        return fallbackValue;
    }

    function resolveConfig(container) {
        const root = container && container.closest
            ? container.closest(".ui-content[data-handrive-page]")
            : document.querySelector(".ui-content[data-handrive-page]");
        const dataset = root ? root.dataset : {};
        return {
            threeModuleUrl: dataset.threeModuleUrl || THREE_VERSION_PATH + "build/three.module.js",
            orbitControlsUrl: dataset.threeOrbitControlsUrl || THREE_VERSION_PATH + "examples/jsm/controls/OrbitControls.js",
            stlLoaderUrl: dataset.threeStlLoaderUrl || THREE_VERSION_PATH + "examples/jsm/loaders/STLLoader.js",
            objLoaderUrl: dataset.threeObjLoaderUrl || THREE_VERSION_PATH + "examples/jsm/loaders/OBJLoader.js",
        };
    }

    function loadModules(config) {
        if (modulesPromise) {
            return modulesPromise;
        }
        modulesPromise = Promise.all([
            import(config.threeModuleUrl),
            import(config.orbitControlsUrl),
            import(config.stlLoaderUrl),
            import(config.objLoaderUrl),
        ]).then(function (modules) {
            return {
                THREE: modules[0],
                OrbitControls: modules[1].OrbitControls,
                STLLoader: modules[2].STLLoader,
                OBJLoader: modules[3].OBJLoader,
            };
        });
        return modulesPromise;
    }

    function setStatus(container, message) {
        const status = container.querySelector("[data-handrive-model-status]");
        if (!status) {
            return;
        }
        status.textContent = message || "";
        status.hidden = !message;
    }

    function getModelElements(container) {
        return {
            viewport: container.querySelector("[data-handrive-model-viewport]"),
            resetButton: container.querySelector("[data-handrive-model-reset]"),
            wireframeButton: container.querySelector("[data-handrive-model-wireframe]"),
        };
    }

    function disposeMaterial(material) {
        if (!material) {
            return;
        }
        if (Array.isArray(material)) {
            material.forEach(disposeMaterial);
            return;
        }
        Object.keys(material).forEach(function (key) {
            const value = material[key];
            if (value && typeof value.dispose === "function") {
                value.dispose();
            }
        });
        if (typeof material.dispose === "function") {
            material.dispose();
        }
    }

    function disposeObject(object) {
        if (!object || typeof object.traverse !== "function") {
            return;
        }
        object.traverse(function (child) {
            if (child.geometry && typeof child.geometry.dispose === "function") {
                child.geometry.dispose();
            }
            disposeMaterial(child.material);
        });
    }

    function applyWireframe(object, enabled) {
        if (!object || typeof object.traverse !== "function") {
            return;
        }
        object.traverse(function (child) {
            if (!child.isMesh || !child.material) {
                return;
            }
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(function (material) {
                if (material && Object.prototype.hasOwnProperty.call(material, "wireframe")) {
                    material.wireframe = enabled;
                    material.needsUpdate = true;
                }
            });
        });
    }

    function updateWireframeButton(button, enabled) {
        if (!button) {
            return;
        }
        const label = enabled
            ? t("model_preview_solid", "Show solid")
            : t("model_preview_wireframe", "Show wireframe");
        button.setAttribute("aria-pressed", enabled ? "true" : "false");
        button.setAttribute("aria-label", label);
        button.title = label;
        button.classList.toggle("is-active", Boolean(enabled));
    }

    function createDefaultMaterial(THREE) {
        return new THREE.MeshStandardMaterial({
            color: 0x9bb7d3,
            metalness: 0.04,
            roughness: 0.58,
            side: THREE.DoubleSide,
        });
    }

    function prepareObjMaterials(object, THREE, material) {
        object.traverse(function (child) {
            if (!child.isMesh) {
                return;
            }
            if (!child.material) {
                child.material = material.clone();
            }
            if (child.geometry && typeof child.geometry.computeVertexNormals === "function") {
                child.geometry.computeVertexNormals();
            }
        });
    }

    function fitCameraToObject(instance, object) {
        const THREE = instance.THREE;
        const box = new THREE.Box3().setFromObject(object);
        if (box.isEmpty()) {
            box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
        }
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        object.position.sub(center);

        const maxSize = Math.max(size.x, size.y, size.z, 1);
        const distance = (maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(instance.camera.fov) / 2))) * 1.55;
        instance.camera.near = Math.max(distance / 100, 0.01);
        instance.camera.far = Math.max(distance * 100, 1000);
        instance.camera.position.set(distance * 0.78, distance * 0.58, distance * 0.92);
        instance.camera.updateProjectionMatrix();
        instance.controls.target.set(0, 0, 0);
        instance.controls.update();
    }

    function resizeInstance(instance) {
        if (!instance || instance.disposed) {
            return;
        }
        const width = Math.max(1, Math.floor(instance.viewport.clientWidth || 0));
        const height = Math.max(1, Math.floor(instance.viewport.clientHeight || 0));
        if (width === instance.width && height === instance.height) {
            return;
        }
        instance.width = width;
        instance.height = height;
        instance.camera.aspect = width / height;
        instance.camera.updateProjectionMatrix();
        instance.renderer.setSize(width, height, false);
        instance.renderer.render(instance.scene, instance.camera);
    }

    function animateInstance(instance) {
        if (!instance || instance.disposed) {
            return;
        }
        instance.animationFrame = window.requestAnimationFrame(function () {
            animateInstance(instance);
        });
        instance.controls.update();
        instance.renderer.render(instance.scene, instance.camera);
    }

    function destroyInstance(instance) {
        if (!instance || instance.disposed) {
            return;
        }
        instance.disposed = true;
        instances.delete(instance);
        if (instance.animationFrame !== null) {
            window.cancelAnimationFrame(instance.animationFrame);
        }
        if (instance.resizeObserver) {
            instance.resizeObserver.disconnect();
        }
        if (instance.controls && typeof instance.controls.dispose === "function") {
            instance.controls.dispose();
        }
        disposeObject(instance.scene);
        if (instance.renderer) {
            instance.renderer.dispose();
            if (typeof instance.renderer.forceContextLoss === "function") {
                instance.renderer.forceContextLoss();
            }
            if (instance.renderer.domElement && instance.renderer.domElement.parentNode) {
                instance.renderer.domElement.parentNode.removeChild(instance.renderer.domElement);
            }
        }
        if (instance.container) {
            delete instance.container.__handriveModelPreviewInstance;
            instance.container.removeAttribute("data-handrive-model-ready");
        }
    }

    function destroyStaleInstances() {
        Array.from(instances).forEach(function (instance) {
            if (!instance.container || !document.documentElement.contains(instance.container)) {
                destroyInstance(instance);
            }
        });
    }

    function buildInstance(container, modules) {
        const elements = getModelElements(container);
        if (!elements.viewport) {
            return null;
        }

        const THREE = modules.THREE;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        elements.viewport.replaceChildren(renderer.domElement);

        const controls = new modules.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.9;
        controls.addEventListener("start", function () {
            controls.autoRotate = false;
        });

        scene.add(new THREE.HemisphereLight(0xffffff, 0x1f2937, 1.4));
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
        keyLight.position.set(2.6, 4.2, 3.8);
        scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x9fc5ff, 0.65);
        fillLight.position.set(-3.2, 1.8, -2.4);
        scene.add(fillLight);

        const grid = new THREE.GridHelper(8, 16, 0x8b98a8, 0xc6ccd4);
        grid.material.opacity = 0.18;
        grid.material.transparent = true;
        scene.add(grid);

        const modelRoot = new THREE.Group();
        scene.add(modelRoot);

        const instance = {
            THREE: THREE,
            camera: camera,
            container: container,
            controls: controls,
            disposed: false,
            modelRoot: modelRoot,
            renderer: renderer,
            scene: scene,
            viewport: elements.viewport,
            width: 0,
            height: 0,
            wireframe: false,
            animationFrame: null,
            resizeObserver: null,
        };

        if (window.ResizeObserver) {
            instance.resizeObserver = new ResizeObserver(function () {
                resizeInstance(instance);
            });
            instance.resizeObserver.observe(elements.viewport);
        }
        window.requestAnimationFrame(function () {
            resizeInstance(instance);
        });

        if (elements.resetButton) {
            elements.resetButton.addEventListener("click", function () {
                controls.autoRotate = true;
                fitCameraToObject(instance, modelRoot);
            });
        }
        if (elements.wireframeButton) {
            updateWireframeButton(elements.wireframeButton, false);
            elements.wireframeButton.addEventListener("click", function () {
                instance.wireframe = !instance.wireframe;
                applyWireframe(modelRoot, instance.wireframe);
                updateWireframeButton(elements.wireframeButton, instance.wireframe);
            });
        }

        return instance;
    }

    function loadModelIntoInstance(instance, modules) {
        const container = instance.container;
        const extension = String(container.dataset.modelExtension || "").toLowerCase();
        const modelUrl = String(container.dataset.modelUrl || "").trim();
        if (!modelUrl) {
            return Promise.reject(new Error(t("model_preview_error", "Failed to display 3D model.")));
        }

        const material = createDefaultMaterial(modules.THREE);
        return new Promise(function (resolve, reject) {
            const onLoad = function (object) {
                if (instance.disposed) {
                    disposeObject(object);
                    resolve();
                    return;
                }
                instance.modelRoot.add(object);
                fitCameraToObject(instance, instance.modelRoot);
                resizeInstance(instance);
                instance.container.classList.remove("is-loading");
                instance.container.dataset.handriveModelReady = "1";
                setStatus(instance.container, "");
                animateInstance(instance);
                resolve();
            };
            const onError = function (error) {
                reject(error || new Error(t("model_preview_error", "Failed to display 3D model.")));
            };

            if (extension === ".stl") {
                const loader = new modules.STLLoader();
                loader.load(modelUrl, function (geometry) {
                    if (geometry && typeof geometry.computeVertexNormals === "function") {
                        geometry.computeVertexNormals();
                    }
                    onLoad(new modules.THREE.Mesh(geometry, material));
                }, undefined, onError);
                return;
            }

            const loader = new modules.OBJLoader();
            loader.load(modelUrl, function (object) {
                prepareObjMaterials(object, modules.THREE, material);
                onLoad(object);
            }, undefined, onError);
        });
    }

    function initContainer(container) {
        if (!container || container.__handriveModelPreviewInstance) {
            return;
        }
        container.__handriveModelPreviewInstance = { pending: true };
        container.classList.add("is-loading");
        setStatus(container, t("model_preview_loading", "Loading 3D model..."));

        const config = resolveConfig(container);
        loadModules(config)
            .then(function (modules) {
                const marker = container.__handriveModelPreviewInstance;
                if (
                    !document.documentElement.contains(container) ||
                    (marker && marker.disposed)
                ) {
                    return;
                }
                const instance = buildInstance(container, modules);
                if (!instance) {
                    return;
                }
                container.__handriveModelPreviewInstance = instance;
                instances.add(instance);
                return loadModelIntoInstance(instance, modules);
            })
            .catch(function () {
                const marker = container.__handriveModelPreviewInstance;
                if (!document.documentElement.contains(container) || (marker && marker.disposed)) {
                    return;
                }
                container.classList.remove("is-loading");
                container.classList.add("has-error");
                setStatus(container, t("model_preview_error", "Failed to display 3D model."));
                delete container.__handriveModelPreviewInstance;
            });
    }

    function hydrate(root) {
        destroyStaleInstances();
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll("[data-handrive-model-preview]").forEach(initContainer);
    }

    function destroy(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const containers = new Set(Array.from(scope.querySelectorAll("[data-handrive-model-preview]")));
        if (scope.matches && scope.matches("[data-handrive-model-preview]")) {
            containers.add(scope);
        }
        containers.forEach(function (container) {
            const marker = container.__handriveModelPreviewInstance;
            if (marker && marker.pending) {
                marker.disposed = true;
                container.classList.remove("is-loading");
            }
        });
        Array.from(instances).forEach(function (instance) {
            if (containers.has(instance.container)) {
                destroyInstance(instance);
            }
        });
    }

    window.HandriveModelPreview = {
        hydrate: hydrate,
        destroy: destroy,
    };
})();
