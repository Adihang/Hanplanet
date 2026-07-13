// Shared content helpers for portfolio print/export flows: escaping, embed fallbacks, and image layout logic.
(function () {
    if (window.__portfolioPrintContentHelpers) {
        return;
    }

    const pageLang = (document.documentElement.getAttribute('lang') || 'ko').toLowerCase();
    const isEnglishPage = pageLang.startsWith('en');

    const escapeHtml = function (value) {
        // The print popup is assembled from strings, so user/content-derived text must
        // be escaped before it is interpolated into HTML fragments.
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const extractYouTubeVideoId = function (rawUrl) {
        // Recognize the main YouTube URL shapes so embedded videos can print as thumbnail links.
        if (!rawUrl) {
            return '';
        }

        try {
            const parsedUrl = new URL(rawUrl, window.location.origin);
            const host = parsedUrl.hostname.toLowerCase();
            let videoId = '';

            if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
                videoId = parsedUrl.pathname.split('/').filter(Boolean)[0] || '';
            } else if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
                const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
                const embedIndex = pathSegments.indexOf('embed');

                if (embedIndex >= 0 && pathSegments[embedIndex + 1]) {
                    videoId = pathSegments[embedIndex + 1];
                }

                if (!videoId && pathSegments[0] === 'shorts' && pathSegments[1]) {
                    videoId = pathSegments[1];
                }

                if (!videoId) {
                    videoId = parsedUrl.searchParams.get('v') || '';
                }
            }

            videoId = (videoId || '').split('&')[0].split('?')[0].trim();
            return /^[A-Za-z0-9_-]{6,20}$/.test(videoId) ? videoId : '';
        } catch (error) {
            return '';
        }
    };

    const toAbsoluteUrl = function (rawUrl) {
        if (!rawUrl) {
            return '';
        }

        try {
            return new URL(rawUrl, window.location.origin).toString();
        } catch (error) {
            return '';
        }
    };

    const resolveEmbeddedMediaTitle = function (rawTitle, projectTitle) {
        const title = (rawTitle || '').trim();
        const lowered = title.toLowerCase();
        const genericTitle = !title ||
            lowered === 'youtube video player' ||
            lowered === 'video player' ||
            lowered === 'youtube' ||
            (lowered.includes('youtube') && lowered.includes('player')) ||
            title.includes('동영상 플레이어');

        if (!genericTitle) {
            return title;
        }

        const normalizedProjectTitle = (projectTitle || '').trim();
        if (normalizedProjectTitle) {
            return isEnglishPage ? (normalizedProjectTitle + ' video') : (normalizedProjectTitle + ' 영상');
        }

        return isEnglishPage ? 'Project video' : '프로젝트 영상';
    };

    const buildEmbeddedMediaFallbackNode = function (embedUrl, mediaTitle) {
        // Non-YouTube embeds degrade to a plain link so printed output still preserves the target media URL.
        const absoluteUrl = toAbsoluteUrl(embedUrl);
        if (!absoluteUrl) {
            return null;
        }

        const paragraph = document.createElement('p');
        paragraph.className = 'print-embed-link';

        const anchor = document.createElement('a');
        anchor.href = absoluteUrl;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = (mediaTitle || '').trim() || (isEnglishPage ? 'Embedded media link' : '임베드 미디어 링크');

        paragraph.appendChild(anchor);
        return paragraph;
    };

    const buildYouTubeThumbnailNode = function (embedUrl, mediaTitle) {
        // YouTube embeds print as thumbnail cards because iframe playback is not meaningful on paper/PDF.
        const videoId = extractYouTubeVideoId(embedUrl);
        if (!videoId) {
            return null;
        }

        const watchUrl = 'https://www.youtube.com/watch?v=' + videoId;
        const thumbnailUrl = 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';

        const figure = document.createElement('figure');
        figure.className = 'print-video-thumb';

        const link = document.createElement('a');
        link.href = watchUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'print-video-thumb-link';

        const image = document.createElement('img');
        image.src = thumbnailUrl;
        image.alt = mediaTitle || (isEnglishPage ? 'YouTube video thumbnail' : '유튜브 영상 썸네일');
        image.loading = 'eager';
        image.decoding = 'sync';
        link.appendChild(image);

        const caption = document.createElement('figcaption');
        const captionLink = document.createElement('a');
        captionLink.href = watchUrl;
        captionLink.target = '_blank';
        captionLink.rel = 'noopener noreferrer';
        captionLink.textContent = mediaTitle || (isEnglishPage ? 'YouTube video link' : '유튜브 영상 링크');
        caption.appendChild(captionLink);

        figure.appendChild(link);
        figure.appendChild(caption);
        return figure;
    };

    const absolutizeResourceUrls = function (container, baseUrl) {
        // Print popups need absolute asset URLs because they no longer inherit the source page base context.
        if (!container) {
            return;
        }

        container.querySelectorAll('[src]').forEach(function (element) {
            const rawSrc = element.getAttribute('src');
            if (!rawSrc) {
                return;
            }

            try {
                element.setAttribute('src', new URL(rawSrc, baseUrl).toString());
            } catch (error) {}
        });

        container.querySelectorAll('a[href]').forEach(function (element) {
            const rawHref = element.getAttribute('href');
            if (!rawHref || rawHref.startsWith('#')) {
                return;
            }

            try {
                element.setAttribute('href', new URL(rawHref, baseUrl).toString());
            } catch (error) {}
        });
    };

    const mmToPx = function (mm) {
        // Browser print layout still works in CSS pixels internally, so convert from
        // page-friendly millimeter measurements once and reuse the constants everywhere.
        return mm * (96 / 25.4);
    };

    const PRINT_IMAGE_LAYOUT = {
        landscapePerRow: 2,
        squarePerRow: 3,
        portraitPerRow: 4,
        defaultGapPx: 10,
        sidePaddingReservePx: 14,
        rowSafetyScale: 0.88,
        fallbackContainerWidthPx: mmToPx(186),
        landscapeMaxHeightPx: mmToPx(84),
        squareMaxHeightPx: mmToPx(90),
        portraitMaxHeightPx: mmToPx(106),
        portraitMaxWidthMm: 45.6,
        landscapeWidthByPortraitMultiplier: 2.0,
        minWidthPx: 72
    };

    const getPrintTargetWidthByRow = function (availableWidth, perRow) {
        return Math.max(
            Math.floor(
                (
                    (availableWidth - (PRINT_IMAGE_LAYOUT.defaultGapPx * (perRow - 1))) /
                    perRow
                ) * PRINT_IMAGE_LAYOUT.rowSafetyScale
            ),
            PRINT_IMAGE_LAYOUT.minWidthPx
        );
    };

    const getPrintImageLayoutForRatio = function (ratio) {
        // Choose a row density based on orientation so print pages stay visually balanced.
        if (!ratio || !Number.isFinite(ratio)) {
            return {
                perRow: PRINT_IMAGE_LAYOUT.squarePerRow,
                maxHeightPx: PRINT_IMAGE_LAYOUT.squareMaxHeightPx
            };
        }

        if (ratio >= 1.15) {
            return {
                perRow: PRINT_IMAGE_LAYOUT.landscapePerRow,
                maxHeightPx: PRINT_IMAGE_LAYOUT.landscapeMaxHeightPx
            };
        }

        if (ratio <= 0.85) {
            return {
                perRow: PRINT_IMAGE_LAYOUT.portraitPerRow,
                maxHeightPx: PRINT_IMAGE_LAYOUT.portraitMaxHeightPx
            };
        }

        return {
            perRow: PRINT_IMAGE_LAYOUT.squarePerRow,
            maxHeightPx: PRINT_IMAGE_LAYOUT.squareMaxHeightPx
        };
    };

    const applyPrintImageSizeConstraints = function (image) {
        // Constrain images by aspect bucket so portrait, square, and landscape media
        // can share a page without one orientation dominating the layout.
        if (!image) {
            return;
        }

        const naturalWidth = image.naturalWidth || 0;
        const naturalHeight = image.naturalHeight || 0;

        if (!naturalWidth || !naturalHeight) {
            image.style.width = 'auto';
            image.style.height = 'auto';
            image.style.maxWidth = 'min(100%, ' + (PRINT_IMAGE_LAYOUT.portraitMaxWidthMm * PRINT_IMAGE_LAYOUT.landscapeWidthByPortraitMultiplier) + 'mm)';
            image.style.maxHeight = '136mm';
            image.style.objectFit = 'contain';
            return;
        }

        const ratio = naturalWidth / naturalHeight;
        const layoutRule = getPrintImageLayoutForRatio(ratio);
        const parentWidth = image.parentElement && image.parentElement.clientWidth
            ? image.parentElement.clientWidth
            : PRINT_IMAGE_LAYOUT.fallbackContainerWidthPx;
        const availableWidth = Math.max(
            parentWidth - PRINT_IMAGE_LAYOUT.sidePaddingReservePx,
            PRINT_IMAGE_LAYOUT.minWidthPx * layoutRule.perRow
        );
        const targetWidthByRow = getPrintTargetWidthByRow(availableWidth, layoutRule.perRow);
        const portraitWidthByRow = getPrintTargetWidthByRow(availableWidth, PRINT_IMAGE_LAYOUT.portraitPerRow);
        const portraitMaxWidthPx = Math.max(
            PRINT_IMAGE_LAYOUT.minWidthPx,
            Math.min(portraitWidthByRow, mmToPx(PRINT_IMAGE_LAYOUT.portraitMaxWidthMm))
        );
        const landscapeMaxWidthPx = portraitMaxWidthPx * PRINT_IMAGE_LAYOUT.landscapeWidthByPortraitMultiplier;
        const scale = Math.min(
            targetWidthByRow / naturalWidth,
            layoutRule.maxHeightPx / naturalHeight,
            ratio >= 1.15 ? (landscapeMaxWidthPx / naturalWidth) : 1,
            1
        );

        image.style.width = Math.round(naturalWidth * scale) + 'px';
        image.style.height = Math.round(naturalHeight * scale) + 'px';
        image.style.maxWidth = 'none';
        image.style.maxHeight = 'none';
        image.style.objectFit = 'contain';
    };

    const normalizeProjectPrintMediaLayout = function (container, projectTitle) {
        // Convert iframe-heavy project content into static print-friendly media blocks before printing.
        if (!container) {
            return;
        }

        container.querySelectorAll('iframe[src]').forEach(function (iframeNode) {
            const src = iframeNode.getAttribute('src') || '';
            const iframeTitle = iframeNode.getAttribute('title') || '';
            const mediaTitle = resolveEmbeddedMediaTitle(iframeTitle, projectTitle);
            const replacementNode = buildYouTubeThumbnailNode(src, mediaTitle) || buildEmbeddedMediaFallbackNode(src, mediaTitle);
            const wrapperNode = iframeNode.parentElement;
            const isResponsiveWrapper = wrapperNode &&
                wrapperNode.classList &&
                wrapperNode.classList.contains('responsive-iframe') &&
                wrapperNode.children.length === 1;

            if (replacementNode) {
                if (isResponsiveWrapper) {
                    wrapperNode.replaceWith(replacementNode);
                } else {
                    iframeNode.replaceWith(replacementNode);
                }
            } else {
                if (isResponsiveWrapper) {
                    wrapperNode.remove();
                } else {
                    iframeNode.remove();
                }
            }
        });

        container.querySelectorAll('img').forEach(function (image) {
            const dataSrc = image.getAttribute('data-src');
            if (dataSrc && !image.getAttribute('src')) {
                image.setAttribute('src', dataSrc);
            }

            const dataSrcset = image.getAttribute('data-srcset');
            if (dataSrcset && !image.getAttribute('srcset')) {
                image.setAttribute('srcset', dataSrcset);
            }

            image.setAttribute('loading', 'eager');
            image.setAttribute('decoding', 'sync');
            image.setAttribute('data-print-project-image', '1');
            applyPrintImageSizeConstraints(image);
        });

        container.querySelectorAll('.portfolio-project-image-strip,[style*="overflow-x: auto"],[style*="overflow-x:auto"]').forEach(function (node) {
            node.style.overflowX = 'visible';
            node.style.overflow = 'visible';
            node.style.whiteSpace = 'normal';

            const isProjectImageStrip = node.classList && node.classList.contains('portfolio-project-image-strip');
            const displayValue = (node.style.display || '').toLowerCase();
            if (isProjectImageStrip || displayValue === 'flex' || displayValue === 'inline-flex') {
                node.style.flexWrap = 'wrap';
                if (!node.style.justifyContent) {
                    node.style.justifyContent = 'center';
                }
            }
        });
    };

    const renderMermaidDiagramsForPrint = function (container) {
        // Project pages fetched for print are parsed in a detached document, so their scripts never run.
        // Render Mermaid in the parent page first, then pass static SVG markup into the print popup.
        if (
            !container ||
            !container.querySelector ||
            !container.querySelector('.handrive-mermaid[data-handrive-mermaid-diagram]')
        ) {
            return Promise.resolve([]);
        }

        const renderer = window.HanplanetMarkdownMermaid;
        if (!renderer || typeof renderer.render !== 'function') {
            return Promise.resolve([]);
        }

        return Promise.resolve(renderer.render(container, { force: true }))
            .catch(function () {
                return [];
            });
    };

    const waitForImagesReady = function (doc, timeoutMs) {
        // Printing waits on image decode so resized screenshots/thumbnails appear at their final dimensions.
        const images = Array.from(doc.querySelectorAll('img[src]'));
        if (images.length === 0) {
            return Promise.resolve();
        }

        return new Promise(function (resolve) {
            let pending = 0;
            let finished = false;

            const finish = function () {
                if (finished) {
                    return;
                }
                finished = true;
                resolve();
            };

            const markDone = function () {
                pending -= 1;
                if (pending <= 0) {
                    finish();
                }
            };

            images.forEach(function (image) {
                image.setAttribute('loading', 'eager');
                image.setAttribute('decoding', 'sync');
                const shouldApplyPrintConstraint = image.closest('.print-project') || image.getAttribute('data-print-project-image') === '1';
                if (shouldApplyPrintConstraint) {
                    applyPrintImageSizeConstraints(image);
                }

                if (image.complete && image.naturalWidth > 0) {
                    if (shouldApplyPrintConstraint) {
                        applyPrintImageSizeConstraints(image);
                    }
                    return;
                }

                pending += 1;
                const onDone = function () {
                    image.removeEventListener('load', onDone);
                    image.removeEventListener('error', onDone);
                    if (shouldApplyPrintConstraint) {
                        applyPrintImageSizeConstraints(image);
                    }
                    markDone();
                };

                image.addEventListener('load', onDone, { once: true });
                image.addEventListener('error', onDone, { once: true });
            });

            if (pending === 0) {
                finish();
                return;
            }

            window.setTimeout(finish, timeoutMs || 4000);
        });
    };

    window.__portfolioPrintContentHelpers = {
        escapeHtml: escapeHtml,
        absolutizeResourceUrls: absolutizeResourceUrls,
        normalizeProjectPrintMediaLayout: normalizeProjectPrintMediaLayout,
        renderMermaidDiagramsForPrint: renderMermaidDiagramsForPrint,
        waitForImagesReady: waitForImagesReady,
        PRINT_IMAGE_LAYOUT: PRINT_IMAGE_LAYOUT
    };
})();
