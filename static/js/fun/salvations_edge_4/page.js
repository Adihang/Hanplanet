// Salvation's Edge helper page script.
document.addEventListener('DOMContentLoaded', function() {
    const POSITIONS = ['left', 'middle', 'right'];
    const SIMPLE_SHAPES = ['triangle', 'circle', 'square'];
    const SIMPLE_DISPLAY_ORDER = ['triangle', 'square', 'circle'];
    const VOLUME_ORDER = ['cube', 'sphere', 'pyramid', 'cylinder', 'prism', 'cone'];
    const VOLUMES = Object.freeze({
        cube: ['square', 'square'],
        pyramid: ['triangle', 'triangle'],
        sphere: ['circle', 'circle'],
        cylinder: ['circle', 'square'],
        prism: ['square', 'triangle'],
        cone: ['circle', 'triangle'],
    });
    const TEXT = Object.freeze(readSalvationsText());

    function readSalvationsText() {
        const textScript = document.getElementById('salvations-i18n');
        if (!textScript) return {};
        try {
            return JSON.parse(textScript.textContent || '{}');
        } catch (error) {
            return {};
        }
    }

    function t(key, replacements) {
        let value = TEXT[key] || key;
        if (!replacements) return value;
        Object.entries(replacements).forEach(([name, replacement]) => {
            value = value.replaceAll('{' + name + '}', replacement);
        });
        return value;
    }

    const POSITION_LABELS = Object.freeze({
        left: t('positionLeft'),
        middle: t('positionMiddle'),
        right: t('positionRight'),
    });
    const SIMPLE_LABELS = Object.freeze({
        triangle: '△',
        square: '□',
        circle: '○',
    });
    const SIMPLE_NAMES = Object.freeze({
        triangle: t('shapeTriangle'),
        square: t('shapeSquare'),
        circle: t('shapeCircle'),
    });
    const VOLUME_NAMES = Object.freeze({
        cube: t('volumeCube'),
        sphere: t('volumeSphere'),
        pyramid: t('volumePyramid'),
        cylinder: t('volumeCylinder'),
        prism: t('volumePrism'),
        cone: t('volumeCone'),
    });
    const VOLUME_ICON_SVGS = Object.freeze({
        cube:
            '<path class="volume-fill" d="M12 18H30V36H12Z"></path>' +
            '<path class="volume-fill volume-soft" d="M18 12H36V30H30V18H18Z"></path>' +
            '<path class="volume-line" d="M12 18H30V36H12ZM18 12H36V30H30M18 12L12 18M36 12L30 18M36 30L30 36M18 30L12 36"></path>',
        sphere:
            '<circle class="volume-fill" cx="24" cy="24" r="15"></circle>' +
            '<ellipse class="volume-line" cx="24" cy="24" rx="15" ry="5"></ellipse>' +
            '<ellipse class="volume-line" cx="24" cy="24" rx="6" ry="15"></ellipse>' +
            '<path class="volume-hidden" d="M12 20C17 24 31 24 36 20"></path>',
        pyramid:
            '<path class="volume-fill" d="M24 8L9 35H39Z"></path>' +
            '<path class="volume-fill volume-soft" d="M24 8L39 35L28 29Z"></path>' +
            '<path class="volume-line" d="M24 8L9 35H39ZM24 8L28 29M24 8L39 35M28 29L9 35M28 29L39 35"></path>' +
            '<path class="volume-hidden" d="M9 35L28 29"></path>',
        cylinder:
            '<path class="volume-fill" d="M12 12C12 7 36 7 36 12V36C36 41 12 41 12 36Z"></path>' +
            '<ellipse class="volume-line" cx="24" cy="12" rx="12" ry="5"></ellipse>' +
            '<path class="volume-line" d="M12 12V36M36 12V36"></path>' +
            '<path class="volume-line" d="M12 36C12 41 36 41 36 36"></path>' +
            '<path class="volume-hidden" d="M12 36C12 31 36 31 36 36"></path>',
        prism:
            '<path class="volume-fill volume-soft" d="M24 6L8 17H40Z"></path>' +
            '<path class="volume-fill" d="M24 31L8 43H40Z"></path>' +
            '<path class="volume-line" d="M24 6L8 17H40ZM24 31L8 43H40ZM24 6V31M8 17V43M40 17V43"></path>',
        cone:
            '<path class="volume-fill" d="M24 7L9 34C9 40 39 40 39 34Z"></path>' +
            '<path class="volume-line" d="M24 7L9 34M24 7L39 34"></path>' +
            '<ellipse class="volume-line" cx="24" cy="34" rx="15" ry="6"></ellipse>' +
            '<path class="volume-hidden" d="M9 34C13 30 35 30 39 34"></path>',
    });
    const INSIDE_JACKPOT_OPTIONS = Object.freeze([
        { value: 'zero', label: t('jackpotZero') },
        { value: 'one', label: t('jackpotOne') },
        { value: 'three', label: t('jackpotThree') },
    ]);
    const INSIDE_SELF_OPTIONS = Object.freeze([
        { value: 'yes', label: t('yes') },
        { value: 'no', label: t('no') },
    ]);

    const mainTextElements = document.querySelectorAll('.main_text');
    const selectTeam = document.querySelector('.select_team');
    const mainTitle = document.getElementById('main_title1');
    const mainTitle2 = document.getElementById('main_title2');
    const insideCalculator = document.getElementById('inside_calculator');
    const insideGrid = document.getElementById('inside_grid');
    const insideResult = document.getElementById('inside_result');
    const insideBack = document.getElementById('inside_back');
    const insideReset = document.getElementById('inside_reset');
    const outsideCalculator = document.getElementById('outside_calculator');
    const outsideGrid = document.getElementById('outside_grid');
    const outsideResult = document.getElementById('outside_result');
    const outsideBack = document.getElementById('outside_back');
    const outsideReset = document.getElementById('outside_reset');

    let insideSelected = buildEmptySelection();
    let outsideSelected = buildEmptySelection();
    let insideGuideShape = '';
    let insideGuideJackpotCount = '';
    let insideGuideSelfJackpot = '';

    function buildEmptySelection() {
        return { left: '', middle: '', right: '' };
    }

    function setCalculatorActive(active) {
        document.body.classList.toggle('salvations-outside-active', active);
        if (active) {
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
    }

    function resetInsideCalculatorState() {
        insideGuideShape = '';
        insideGuideJackpotCount = '';
        insideGuideSelfJackpot = '';
        renderInsideCalculator();
    }

    function resetOutsideState() {
        insideSelected = buildEmptySelection();
        outsideSelected = buildEmptySelection();
        renderOutsideCalculator();
    }

    function showTeamSelection() {
        setCalculatorActive(false);
        resetInsideCalculatorState();
        resetOutsideState();
        insideCalculator.hidden = true;
        outsideCalculator.hidden = true;
        selectTeam.style.display = 'flex';
        mainTitle.textContent = t('selectTeam');
        mainTitle2.textContent = '';
    }

    function showOutsideCalculator() {
        setCalculatorActive(true);
        selectTeam.style.display = 'none';
        insideCalculator.hidden = true;
        outsideCalculator.hidden = false;
        mainTitle.textContent = t('outsideCalculator');
        mainTitle2.textContent = '';
        resetOutsideState();
    }

    function showInsideCalculator() {
        setCalculatorActive(true);
        selectTeam.style.display = 'none';
        insideCalculator.hidden = false;
        outsideCalculator.hidden = true;
        mainTitle.textContent = t('insideCalculator');
        mainTitle2.textContent = '';
        resetInsideCalculatorState();
    }

    function shapeMarkup(shape) {
        return '<span class="salvation-shape salvation-shape-' + shape + '">' + SIMPLE_LABELS[shape] + '</span>';
    }

    function positionIconMarkup(position) {
        return (
            '<span class="outside_position_icon" role="img" aria-label="' + POSITION_LABELS[position] + '">' +
            POSITIONS.map(iconPosition => (
                '<span class="outside_position_slot' +
                (iconPosition === position ? ' is-active' : '') +
                '"></span>'
            )).join('') +
            '</span>'
        );
    }

    function volumePartsMarkup(volume) {
        return VOLUMES[volume].map(shapeMarkup).join('');
    }

    function volumeIconMarkup(volume) {
        if (!volume) return '<span class="salvation-volume-empty">-</span>';
        return (
            '<span class="salvation-volume-icon salvation-volume-' + volume + '"' +
            ' role="img" aria-label="' + VOLUME_NAMES[volume] + '">' +
            '<svg class="salvation-volume-svg" viewBox="0 0 48 48" focusable="false" aria-hidden="true">' +
            VOLUME_ICON_SVGS[volume] +
            '</svg>' +
            '</span>'
        );
    }

    function volumeMarkup(volume) {
        if (!volume) return '-';
        return (
            '<span class="salvation-volume-value" aria-label="' +
            VOLUME_NAMES[volume] + ' ' + VOLUMES[volume].map(shape => SIMPLE_LABELS[shape]).join('') +
            '">' +
            volumeIconMarkup(volume) +
            '<span class="outside_volume_parts">' + volumePartsMarkup(volume) + '</span>' +
            '</span>'
        );
    }

    function shapeNameMarkup(shape) {
        return shapeMarkup(shape) + '<span>' + SIMPLE_NAMES[shape] + '</span>';
    }

    function renderInsidePickButton(type, value, label, selected, content) {
        return (
            '<button type="button" class="inside_pick outside_pick' +
            (selected ? ' is-selected' : '') +
            '" data-inside-pick-type="' + type + '" data-value="' + value + '"' +
            ' aria-pressed="' + (selected ? 'true' : 'false') + '">' +
            (content || '<span>' + label + '</span>') +
            '</button>'
        );
    }

    function renderInsideShapeButton(shape) {
        return renderInsidePickButton(
            'shape',
            shape,
            SIMPLE_NAMES[shape],
            insideGuideShape === shape,
            shapeNameMarkup(shape)
        );
    }

    function renderInsideJackpotButton(option) {
        return renderInsidePickButton(
            'jackpot',
            option.value,
            option.label,
            insideGuideJackpotCount === option.value,
            '<span>' + option.label + '</span>'
        );
    }

    function renderInsideSelfButton(option) {
        return renderInsidePickButton(
            'self',
            option.value,
            option.label,
            insideGuideSelfJackpot === option.value,
            '<span>' + option.label + '</span>'
        );
    }

    function renderInsidePanel(title, bodyHtml) {
        return (
            '<section class="inside_panel">' +
            '<h2 class="inside_panel_title">' + title + '</h2>' +
            bodyHtml +
            '</section>'
        );
    }

    function renderInsideResultCard(title, lines) {
        return (
            '<article class="inside_result_card">' +
            '<h3>' + title + '</h3>' +
            lines.map(line => '<p>' + line + '</p>').join('') +
            '</article>'
        );
    }

    function renderInsideResultCards(cards) {
        return '<div class="inside_result_cards">' + cards.join('') + '</div>';
    }

    function getInsideFinalHoldShapes() {
        if (!insideGuideShape) return [];
        return SIMPLE_DISPLAY_ORDER.filter(shape => shape !== insideGuideShape);
    }

    function renderInsideFinalHoldCard() {
        const finalShapes = getInsideFinalHoldShapes();
        if (finalShapes.length !== 2) return '';
        return renderInsideResultCard(
            t('finalHold'),
            [finalShapes.map(shapeNameMarkup).join('')]
        );
    }

    function renderInsideFinalHoldBlock() {
        const finalHoldCard = renderInsideFinalHoldCard();
        if (!finalHoldCard) return '';
        return '<div class="inside_final_hold">' + finalHoldCard + '</div>';
    }

    function renderInsideResultWithFinalHold(cards, trailingHtml) {
        const cardsHtml = cards.length ? renderInsideResultCards(cards) : '';
        return cardsHtml + (trailingHtml || '') + renderInsideFinalHoldBlock();
    }

    function renderInsideEmptyResult(message) {
        return '<div class="outside_result_empty">' + message + '</div>';
    }

    function renderInsideResult() {
        if (!insideGuideShape) {
            return renderInsideEmptyResult(t('chooseMySymbol'));
        }

        if (!insideGuideJackpotCount) {
            return renderInsideResultWithFinalHold(
                [],
                renderInsideEmptyResult(t('chooseJackpotCount'))
            );
        }

        if (insideGuideJackpotCount === 'zero') {
            const otherShapes = SIMPLE_DISPLAY_ORDER.filter(shape => shape !== insideGuideShape);
            const cards = otherShapes.map(otherShape => {
                const targetShape = SIMPLE_DISPLAY_ORDER.find(shape => (
                    shape !== insideGuideShape && shape !== otherShape
                ));
                return renderInsideResultCard(
                    t('wallSymbols', {
                        mine: SIMPLE_LABELS[insideGuideShape],
                        other: SIMPLE_LABELS[otherShape],
                    }),
                    [
                        t('giveBothToHolder', { shape: shapeNameMarkup(targetShape) }),
                    ]
                );
            });
            return renderInsideResultWithFinalHold(cards);
        }

        if (insideGuideJackpotCount === 'three') {
            return renderInsideResultWithFinalHold([
                renderInsideResultCard(
                    t('transferOrder'),
                    [t('splitTransfer')]
                ),
            ]);
        }

        if (!insideGuideSelfJackpot) {
            return renderInsideResultWithFinalHold(
                [],
                renderInsideEmptyResult(t('chooseSelfJackpot'))
            );
        }

        if (insideGuideSelfJackpot === 'yes') {
            return renderInsideResultWithFinalHold([
                renderInsideResultCard(
                    t('transferOrder'),
                    [t('splitTransfer')]
                ),
            ]);
        }

        return renderInsideResultWithFinalHold([
            renderInsideResultCard(
                t('firstTransfer'),
                [t('giveShapeToNonJackpot', { shape: shapeNameMarkup(insideGuideShape) })]
            ),
            renderInsideResultCard(
                t('secondTransfer'),
                [t('giveRemainingToJackpot')]
            ),
        ]);
    }

    function matchShapes(values, shapesToMatch) {
        const firstShapeIndex = values.findIndex(val => val === shapesToMatch[0]);
        const secondShapeIndex = values.findIndex((val, index) => (
            index !== firstShapeIndex && val === shapesToMatch[1]
        ));
        return [firstShapeIndex, secondShapeIndex];
    }

    function simplePairToVolume(shapeArr) {
        const match = Object.entries(VOLUMES).find(([, values]) => {
            const [firstShape, secondShape] = matchShapes(values, shapeArr);
            return firstShape > -1 && secondShape > -1;
        });
        return match ? match[0] : '';
    }

    function calculateOutput(insideSymbols) {
        return insideSymbols.map(shape => (
            SIMPLE_SHAPES.filter(step => step !== shape).sort()
        ));
    }

    function resultMatchesSolution(result, solution) {
        return result.reduce((comparisonMap, symbol, symInd) => {
            const symbolMatch = symbol.every(shape => {
                const shapeInSolution = solution[symInd].includes(shape);
                const solutionShapeFilter = solution[symInd].filter(s => s === shape).length;
                const resultShapeFilter = symbol.filter(s => s === shape).length;
                return shapeInSolution && solutionShapeFilter === resultShapeFilter;
            });
            return [...comparisonMap, symbolMatch];
        }, []);
    }

    function calculateActionMatrix(step, outsideEndArr) {
        let total = 0;
        const matches = [[], [], []];
        const results = step.map(shapes => [...shapes]);
        const allPureSymbols = step.every(symbol => symbol[0] === symbol[1]);

        if (allPureSymbols) {
            matches[0] = [0, 0, step[0][0]];
            matches[2] = [2, 0, step[2][0]];
        } else {
            const pureShape = step.findIndex(shapes => shapes[0] === shapes[1]);
            if (pureShape > -1) {
                matches[pureShape] = [pureShape, 0, step[pureShape][0]];
                total++;
            }

            step.forEach((shapes, index) => {
                if (total === 2 || matches[index].length > 0) return;

                if (
                    shapes[0] !== shapes[1] &&
                    outsideEndArr[index].includes(shapes[0]) &&
                    outsideEndArr[index].includes(shapes[1])
                ) {
                    return;
                }

                const firstShape = Object.values(outsideEndArr[index]).findIndex(
                    val => val === shapes[0]
                );
                const secondShape = Object.values(outsideEndArr[index]).findIndex(
                    (val, shapeIndex) => shapeIndex !== firstShape && val === shapes[1]
                );

                if (firstShape === -1) {
                    matches[index] = [index, 0, shapes[0]];
                }

                if (secondShape === -1) {
                    matches[index] = [index, 1, shapes[1]];
                }

                if (matches[index].length > 0) {
                    total++;
                }
            });
        }

        const populatedMatches = matches.filter(match => match.length > 0);
        if (populatedMatches.length < 2) {
            return [[], []];
        }

        [matches[populatedMatches[0][0]][2], matches[populatedMatches[1][0]][2]] = [
            matches[populatedMatches[1][0]][2],
            matches[populatedMatches[0][0]][2],
        ];

        matches.forEach(([arrIndex, swapIndex, swapValue], index) => {
            if (typeof arrIndex === 'number') {
                results[index][swapIndex] = swapValue;
            }
        });

        [matches[populatedMatches[0][0]][2], matches[populatedMatches[1][0]][2]] = [
            matches[populatedMatches[1][0]][2],
            matches[populatedMatches[0][0]][2],
        ];

        return [matches.map(res => res[2]), results.map(result => result.sort())];
    }

    function buildExecutionStep(step, solution) {
        const swaps = [];
        const results = [];
        let currentStep = step.map(pair => [...pair]);
        let guard = 0;

        while (!resultMatchesSolution(currentStep, solution).every(Boolean) && guard < 12) {
            const [swap, result] = calculateActionMatrix(currentStep, solution);
            if (!Array.isArray(result) || result.length !== 3) {
                return { swaps, results, hasError: true };
            }
            swaps.push(swap);
            results.push(result);
            currentStep = result.map(pair => [...pair]);
            guard++;
        }

        return {
            swaps,
            results,
            hasError: !resultMatchesSolution(currentStep, solution).every(Boolean),
        };
    }

    function countOutsideComponents(selection, overridePosition, overrideValue) {
        const counts = { triangle: 0, circle: 0, square: 0 };
        POSITIONS.forEach(position => {
            const volume = position === overridePosition ? overrideValue : selection[position];
            if (!volume) return;
            VOLUMES[volume].forEach(shape => {
                counts[shape] += 1;
            });
        });
        return counts;
    }

    function isInsideDisabled(shape, position) {
        if (insideSelected[position] === shape) return false;
        return Object.values(insideSelected).includes(shape);
    }

    function isOutsideDisabled(volume, position) {
        if (outsideSelected[position] === volume) return false;
        const counts = countOutsideComponents(outsideSelected, position, volume);
        return Object.values(counts).some(count => count > 2);
    }

    function getEndSolution() {
        const insideValues = POSITIONS.map(position => insideSelected[position]);
        if (insideValues.some(value => value === '')) return null;
        return calculateOutput(insideValues);
    }

    function getInputStatus(endSolution) {
        const insideValues = POSITIONS.map(position => insideSelected[position]);
        const outsideValues = POSITIONS.map(position => outsideSelected[position]);

        if (insideValues.some(value => value === '')) {
            return { valid: false, text: t('selectAllInside') };
        }

        if (new Set(insideValues).size !== 3) {
            return { valid: false, text: t('insideUnique') };
        }

        if (!endSolution) {
            return { valid: false, text: t('finalTargetError') };
        }

        if (outsideValues.some(value => value === '')) {
            return { valid: false, text: t('selectAllOutside') };
        }

        const counts = countOutsideComponents(outsideSelected);
        const hasExactCounts = Object.values(counts).every(count => count === 2);
        if (!hasExactCounts) {
            return {
                valid: false,
                text: t('outsideCounts'),
            };
        }

        return { valid: true, text: t('calculated') };
    }

    function renderSimpleButton(shape, position) {
        const selected = insideSelected[position] === shape;
        const disabled = isInsideDisabled(shape, position);
        return (
            '<button type="button" class="outside_pick outside_pick_simple' +
            (selected ? ' is-selected' : '') +
            '" data-pick-type="inside" data-position="' + position + '" data-value="' + shape + '"' +
            (disabled ? ' disabled' : '') +
            ' aria-pressed="' + (selected ? 'true' : 'false') + '">' +
            shapeMarkup(shape) +
            '<span class="outside_pick_label">' + SIMPLE_NAMES[shape] + '</span>' +
            '</button>'
        );
    }

    function renderVolumeButton(volume, position) {
        const selected = outsideSelected[position] === volume;
        const disabled = isOutsideDisabled(volume, position);
        return (
            '<button type="button" class="outside_pick outside_pick_volume' +
            (selected ? ' is-selected' : '') +
            '" data-pick-type="outside" data-position="' + position + '" data-value="' + volume + '"' +
            (disabled ? ' disabled' : '') +
            ' aria-pressed="' + (selected ? 'true' : 'false') + '">' +
            volumeMarkup(volume) +
            '</button>'
        );
    }

    function renderSide(position, endSolution) {
        return (
            '<section class="outside_side" data-position="' + position + '">' +
            '<h2 class="outside_side_title">' + positionIconMarkup(position) + '</h2>' +
            '<div class="outside_select_group">' +
            '<h3>' + t('insideLabel') + '</h3>' +
            '<div class="outside_pick_grid outside_pick_grid_simple">' +
            SIMPLE_DISPLAY_ORDER.map(shape => renderSimpleButton(shape, position)).join('') +
            '</div>' +
            '</div>' +
            '<div class="outside_select_group">' +
            '<h3>' + t('outsideLabel') + '</h3>' +
            '<div class="outside_pick_grid outside_pick_grid_volume">' +
            VOLUME_ORDER.map(volume => renderVolumeButton(volume, position)).join('') +
            '</div>' +
            '</div>' +
            '</section>'
        );
    }

    function renderDissectValue(shape) {
        if (!shape) {
            return '<span class="outside_step_none">' + t('none') + '</span>';
        }
        return shapeMarkup(shape) + '<span>' + SIMPLE_NAMES[shape] + '</span>';
    }

    function renderPositionStep(position, positionIndex, swaps, results) {
        const stepItems = swaps.map((swap, stepIndex) => {
            const dissectShape = swap[positionIndex];
            const volume = simplePairToVolume(results[stepIndex][positionIndex]);
            const isFinal = stepIndex === swaps.length - 1;

            return (
                '<div class="outside_step_round">' +
                '<div class="outside_step_round_head">' + t('step') + ' ' + (stepIndex + 1) + '</div>' +
                '<div class="outside_step_line">' +
                '<span>' + t('dissect') + '</span>' +
                '<strong>' + renderDissectValue(dissectShape) + '</strong>' +
                '</div>' +
                '<div class="outside_step_line">' +
                '<span>' + (isFinal ? t('answer') : t('create')) + '</span>' +
                '<strong>' + volumeMarkup(volume) + '</strong>' +
                '</div>' +
                '</div>'
            );
        }).join('');

        return (
            '<li class="outside_step" data-position="' + position + '">' +
            '<div class="outside_step_stack">' + stepItems + '</div>' +
            '</li>'
        );
    }

    function renderSolution(endSolution, status) {
        if (!status.valid) {
            outsideResult.innerHTML = '';
            return;
        }

        const outsideValues = POSITIONS.map(position => outsideSelected[position]);
        const startingStep = outsideValues.map(value => VOLUMES[value]);
        const { swaps, results, hasError } = buildExecutionStep(startingStep, endSolution);

        if (hasError) {
            outsideResult.innerHTML = '<div class="outside_result_empty">' + t('loopError') + '</div>';
            return;
        }

        if (swaps.length === 0) {
            outsideResult.innerHTML = '<div class="outside_result_empty">' + t('alreadyMatches') + '</div>';
            return;
        }

        const stepList = POSITIONS.map((position, index) => (
            renderPositionStep(position, index, swaps, results)
        )).join('');

        outsideResult.innerHTML = '<ol class="outside_steps">' + stepList + '</ol>';
    }

    function renderInsideCalculator() {
        if (!insideGrid || !insideResult) return;

        const shapePanel = renderInsidePanel(
            t('myStatueSymbol'),
            '<div class="inside_pick_grid inside_pick_grid_shape">' +
            SIMPLE_DISPLAY_ORDER.map(renderInsideShapeButton).join('') +
            '</div>'
        );
        const jackpotPanel = renderInsidePanel(
            t('jackpotTeammates'),
            '<div class="inside_pick_grid inside_pick_grid_count">' +
            INSIDE_JACKPOT_OPTIONS.map(renderInsideJackpotButton).join('') +
            '</div>'
        );
        const selfPanel = insideGuideJackpotCount === 'one'
            ? renderInsidePanel(
                t('amIJackpot'),
                '<div class="inside_pick_grid inside_pick_grid_self">' +
                INSIDE_SELF_OPTIONS.map(renderInsideSelfButton).join('') +
                '</div>'
            )
            : '';

        insideGrid.innerHTML = shapePanel + jackpotPanel + selfPanel;
        insideResult.innerHTML = renderInsideResult();
    }

    function renderOutsideCalculator() {
        if (!outsideGrid || !outsideResult) return;
        const endSolution = getEndSolution();
        const status = getInputStatus(endSolution);

        outsideGrid.innerHTML = POSITIONS.map(position => renderSide(position, endSolution)).join('');
        renderSolution(endSolution, status);
    }

    function handleInsidePick(button) {
        const type = button.dataset.insidePickType;
        const value = button.dataset.value;
        if (!type || !value) return;

        if (type === 'shape') {
            insideGuideShape = insideGuideShape === value ? '' : value;
        } else if (type === 'jackpot') {
            insideGuideJackpotCount = insideGuideJackpotCount === value ? '' : value;
            if (insideGuideJackpotCount !== 'one') {
                insideGuideSelfJackpot = '';
            }
        } else if (type === 'self') {
            insideGuideSelfJackpot = insideGuideSelfJackpot === value ? '' : value;
        }

        renderInsideCalculator();
    }

    function handleOutsidePick(button) {
        const type = button.dataset.pickType;
        const position = button.dataset.position;
        const value = button.dataset.value;
        if (!POSITIONS.includes(position) || !value) return;

        if (type === 'inside') {
            insideSelected[position] = insideSelected[position] === value ? '' : value;
        } else if (type === 'outside') {
            outsideSelected[position] = outsideSelected[position] === value ? '' : value;
        }

        renderOutsideCalculator();
    }

    mainTextElements.forEach(element => {
        element.addEventListener('click', event => {
            const clickedId = event.target.id;

            if (clickedId === 'team_out') {
                showOutsideCalculator();
            } else if (clickedId === 'team_in') {
                showInsideCalculator();
            }
        });
    });

    insideCalculator.addEventListener('click', event => {
        const pickButton = event.target.closest('.inside_pick');
        if (pickButton && !pickButton.disabled) {
            handleInsidePick(pickButton);
        }
    });

    outsideCalculator.addEventListener('click', event => {
        const pickButton = event.target.closest('.outside_pick');
        if (pickButton && !pickButton.disabled) {
            handleOutsidePick(pickButton);
        }
    });

    insideBack.addEventListener('click', showTeamSelection);
    insideReset.addEventListener('click', resetInsideCalculatorState);
    outsideBack.addEventListener('click', showTeamSelection);
    outsideReset.addEventListener('click', resetOutsideState);
    renderInsideCalculator();
    renderOutsideCalculator();
});
