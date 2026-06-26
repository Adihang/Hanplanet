// Account weather chip and location editor.
(function () {
    'use strict';

    const widgets = Array.from(document.querySelectorAll('[data-auth-account-weather]'));
    if (!widgets.length) {
        return;
    }

    const ACCOUNT_WEATHER_LOCATION_OPTIONS = [
        {
            country: 'South Korea',
            labelKo: '대한민국',
            labelEn: 'South Korea',
            cities: [
                { name: 'Seoul', labelKo: '서울', labelEn: 'Seoul' },
                { name: 'Busan', labelKo: '부산', labelEn: 'Busan' },
                { name: 'Incheon', labelKo: '인천', labelEn: 'Incheon' },
                { name: 'Daegu', labelKo: '대구', labelEn: 'Daegu' },
                { name: 'Daejeon', labelKo: '대전', labelEn: 'Daejeon' },
                { name: 'Gwangju', labelKo: '광주', labelEn: 'Gwangju' },
                { name: 'Suwon', labelKo: '수원', labelEn: 'Suwon' },
                { name: 'Jeju City', labelKo: '제주', labelEn: 'Jeju City' }
            ]
        },
        {
            country: 'United States',
            labelKo: '미국',
            labelEn: 'United States',
            cities: [
                { name: 'New York', labelKo: '뉴욕', labelEn: 'New York' },
                { name: 'Los Angeles', labelKo: '로스앤젤레스', labelEn: 'Los Angeles' },
                { name: 'San Francisco', labelKo: '샌프란시스코', labelEn: 'San Francisco' },
                { name: 'Mountain View', labelKo: '마운틴뷰', labelEn: 'Mountain View' },
                { name: 'Seattle', labelKo: '시애틀', labelEn: 'Seattle' },
                { name: 'Chicago', labelKo: '시카고', labelEn: 'Chicago' },
                { name: 'Austin', labelKo: '오스틴', labelEn: 'Austin' },
                { name: 'Washington', labelKo: '워싱턴 D.C.', labelEn: 'Washington, D.C.' }
            ]
        },
        {
            country: 'Japan',
            labelKo: '일본',
            labelEn: 'Japan',
            cities: [
                { name: 'Tokyo', labelKo: '도쿄', labelEn: 'Tokyo' },
                { name: 'Osaka', labelKo: '오사카', labelEn: 'Osaka' },
                { name: 'Kyoto', labelKo: '교토', labelEn: 'Kyoto' },
                { name: 'Fukuoka', labelKo: '후쿠오카', labelEn: 'Fukuoka' },
                { name: 'Sapporo', labelKo: '삿포로', labelEn: 'Sapporo' }
            ]
        },
        {
            country: 'China',
            labelKo: '중국',
            labelEn: 'China',
            cities: [
                { name: 'Beijing', labelKo: '베이징', labelEn: 'Beijing' },
                { name: 'Shanghai', labelKo: '상하이', labelEn: 'Shanghai' },
                { name: 'Shenzhen', labelKo: '선전', labelEn: 'Shenzhen' },
                { name: 'Guangzhou', labelKo: '광저우', labelEn: 'Guangzhou' }
            ]
        },
        {
            country: 'Taiwan',
            labelKo: '대만',
            labelEn: 'Taiwan',
            cities: [
                { name: 'Taipei', labelKo: '타이베이', labelEn: 'Taipei' },
                { name: 'Taichung', labelKo: '타이중', labelEn: 'Taichung' },
                { name: 'Kaohsiung', labelKo: '가오슝', labelEn: 'Kaohsiung' }
            ]
        },
        {
            country: 'Singapore',
            labelKo: '싱가포르',
            labelEn: 'Singapore',
            cities: [
                { name: 'Singapore', labelKo: '싱가포르', labelEn: 'Singapore' }
            ]
        },
        {
            country: 'Thailand',
            labelKo: '태국',
            labelEn: 'Thailand',
            cities: [
                { name: 'Bangkok', labelKo: '방콕', labelEn: 'Bangkok' },
                { name: 'Chiang Mai', labelKo: '치앙마이', labelEn: 'Chiang Mai' },
                { name: 'Phuket', labelKo: '푸켓', labelEn: 'Phuket' }
            ]
        },
        {
            country: 'Vietnam',
            labelKo: '베트남',
            labelEn: 'Vietnam',
            cities: [
                { name: 'Hanoi', labelKo: '하노이', labelEn: 'Hanoi' },
                { name: 'Ho Chi Minh City', labelKo: '호치민', labelEn: 'Ho Chi Minh City' },
                { name: 'Da Nang', labelKo: '다낭', labelEn: 'Da Nang' }
            ]
        },
        {
            country: 'Philippines',
            labelKo: '필리핀',
            labelEn: 'Philippines',
            cities: [
                { name: 'Manila', labelKo: '마닐라', labelEn: 'Manila' },
                { name: 'Cebu City', labelKo: '세부', labelEn: 'Cebu City' },
                { name: 'Davao City', labelKo: '다바오', labelEn: 'Davao City' }
            ]
        },
        {
            country: 'Indonesia',
            labelKo: '인도네시아',
            labelEn: 'Indonesia',
            cities: [
                { name: 'Jakarta', labelKo: '자카르타', labelEn: 'Jakarta' },
                { name: 'Denpasar', labelKo: '덴파사르', labelEn: 'Denpasar' },
                { name: 'Surabaya', labelKo: '수라바야', labelEn: 'Surabaya' }
            ]
        },
        {
            country: 'India',
            labelKo: '인도',
            labelEn: 'India',
            cities: [
                { name: 'New Delhi', labelKo: '뉴델리', labelEn: 'New Delhi' },
                { name: 'Mumbai', labelKo: '뭄바이', labelEn: 'Mumbai' },
                { name: 'Bengaluru', labelKo: '벵갈루루', labelEn: 'Bengaluru' },
                { name: 'Chennai', labelKo: '첸나이', labelEn: 'Chennai' }
            ]
        },
        {
            country: 'Australia',
            labelKo: '호주',
            labelEn: 'Australia',
            cities: [
                { name: 'Sydney', labelKo: '시드니', labelEn: 'Sydney' },
                { name: 'Melbourne', labelKo: '멜버른', labelEn: 'Melbourne' },
                { name: 'Brisbane', labelKo: '브리즈번', labelEn: 'Brisbane' },
                { name: 'Perth', labelKo: '퍼스', labelEn: 'Perth' }
            ]
        },
        {
            country: 'Canada',
            labelKo: '캐나다',
            labelEn: 'Canada',
            cities: [
                { name: 'Toronto', labelKo: '토론토', labelEn: 'Toronto' },
                { name: 'Vancouver', labelKo: '밴쿠버', labelEn: 'Vancouver' },
                { name: 'Montreal', labelKo: '몬트리올', labelEn: 'Montreal' },
                { name: 'Calgary', labelKo: '캘거리', labelEn: 'Calgary' }
            ]
        },
        {
            country: 'United Kingdom',
            labelKo: '영국',
            labelEn: 'United Kingdom',
            cities: [
                { name: 'London', labelKo: '런던', labelEn: 'London' },
                { name: 'Manchester', labelKo: '맨체스터', labelEn: 'Manchester' },
                { name: 'Edinburgh', labelKo: '에든버러', labelEn: 'Edinburgh' }
            ]
        },
        {
            country: 'France',
            labelKo: '프랑스',
            labelEn: 'France',
            cities: [
                { name: 'Paris', labelKo: '파리', labelEn: 'Paris' },
                { name: 'Lyon', labelKo: '리옹', labelEn: 'Lyon' },
                { name: 'Marseille', labelKo: '마르세유', labelEn: 'Marseille' }
            ]
        },
        {
            country: 'Germany',
            labelKo: '독일',
            labelEn: 'Germany',
            cities: [
                { name: 'Berlin', labelKo: '베를린', labelEn: 'Berlin' },
                { name: 'Munich', labelKo: '뮌헨', labelEn: 'Munich' },
                { name: 'Frankfurt am Main', labelKo: '프랑크푸르트', labelEn: 'Frankfurt' }
            ]
        },
        {
            country: 'Italy',
            labelKo: '이탈리아',
            labelEn: 'Italy',
            cities: [
                { name: 'Rome', labelKo: '로마', labelEn: 'Rome' },
                { name: 'Milan', labelKo: '밀라노', labelEn: 'Milan' },
                { name: 'Venice', labelKo: '베네치아', labelEn: 'Venice' }
            ]
        },
        {
            country: 'Spain',
            labelKo: '스페인',
            labelEn: 'Spain',
            cities: [
                { name: 'Madrid', labelKo: '마드리드', labelEn: 'Madrid' },
                { name: 'Barcelona', labelKo: '바르셀로나', labelEn: 'Barcelona' },
                { name: 'Valencia', labelKo: '발렌시아', labelEn: 'Valencia' }
            ]
        },
        {
            country: 'Brazil',
            labelKo: '브라질',
            labelEn: 'Brazil',
            cities: [
                { name: 'Sao Paulo', labelKo: '상파울루', labelEn: 'Sao Paulo' },
                { name: 'Rio de Janeiro', labelKo: '리우데자네이루', labelEn: 'Rio de Janeiro' },
                { name: 'Brasilia', labelKo: '브라질리아', labelEn: 'Brasilia' }
            ]
        },
        {
            country: 'Mexico',
            labelKo: '멕시코',
            labelEn: 'Mexico',
            cities: [
                { name: 'Mexico City', labelKo: '멕시코시티', labelEn: 'Mexico City' },
                { name: 'Guadalajara', labelKo: '과달라하라', labelEn: 'Guadalajara' },
                { name: 'Monterrey', labelKo: '몬테레이', labelEn: 'Monterrey' }
            ]
        },
        {
            country: 'United Arab Emirates',
            labelKo: '아랍에미리트',
            labelEn: 'United Arab Emirates',
            cities: [
                { name: 'Dubai', labelKo: '두바이', labelEn: 'Dubai' },
                { name: 'Abu Dhabi', labelKo: '아부다비', labelEn: 'Abu Dhabi' }
            ]
        }
    ];

    const isEnglishUi = function () {
        return String(document.documentElement.getAttribute('lang') || '').toLowerCase().startsWith('en');
    };

    const getOptionLabel = function (item) {
        if (!item) {
            return '';
        }
        return String((isEnglishUi() ? item.labelEn : item.labelKo) || item.labelEn || item.labelKo || item.name || item.country || '').trim();
    };

    const findCountryOption = function (country) {
        const value = String(country || '').trim().toLowerCase();
        return ACCOUNT_WEATHER_LOCATION_OPTIONS.find(function (item) {
            return String(item.country || '').trim().toLowerCase() === value;
        }) || null;
    };

    const appendSelectOption = function (select, value, label, disabled) {
        const option = document.createElement('option');
        option.value = String(value || '').trim();
        option.textContent = String(label || value || '').trim();
        option.disabled = Boolean(disabled);
        select.appendChild(option);
        return option;
    };

    const ensureSelectOption = function (select, value, label) {
        const normalizedValue = String(value || '').trim();
        if (!select || !normalizedValue) {
            return;
        }
        const existing = Array.from(select.options || []).find(function (option) {
            return option.value === normalizedValue;
        });
        if (existing) {
            return;
        }
        appendSelectOption(select, normalizedValue, label || normalizedValue, false);
    };

    const getSelectPlaceholder = function (select) {
        const firstOption = select && select.options && select.options.length ? select.options[0] : null;
        return firstOption ? String(firstOption.textContent || '').trim() : '';
    };

    const populateCountryOptions = function (countrySelect, selectedCountry, selectedCountryLabel) {
        if (!countrySelect || countrySelect.dataset.weatherCountriesPopulated === '1') {
            return;
        }
        const placeholder = getSelectPlaceholder(countrySelect) || 'Select country';
        countrySelect.textContent = '';
        appendSelectOption(countrySelect, '', placeholder, false);
        ACCOUNT_WEATHER_LOCATION_OPTIONS.forEach(function (item) {
            appendSelectOption(countrySelect, item.country, getOptionLabel(item), false);
        });
        ensureSelectOption(countrySelect, selectedCountry, selectedCountryLabel);
        countrySelect.value = String(selectedCountry || '').trim();
        countrySelect.dataset.weatherCountriesPopulated = '1';
    };

    const populateCityOptions = function (citySelect, country, selectedCity, selectedCityLabel) {
        if (!citySelect) {
            return;
        }
        const placeholder = getSelectPlaceholder(citySelect) || 'Select city';
        const countryOption = findCountryOption(country);
        citySelect.textContent = '';
        appendSelectOption(citySelect, '', placeholder, false);
        if (countryOption) {
            countryOption.cities.forEach(function (item) {
                appendSelectOption(citySelect, item.name, getOptionLabel(item), false);
            });
        }
        ensureSelectOption(citySelect, selectedCity, selectedCityLabel);
        citySelect.value = String(selectedCity || '').trim();
        citySelect.disabled = !String(country || '').trim();
    };

    const syncLocationSelects = function (widget, location) {
        const countrySelect = widget.querySelector('[data-auth-account-weather-country]');
        const citySelect = widget.querySelector('[data-auth-account-weather-city]');
        if (!countrySelect || !citySelect) {
            return;
        }
        const country = String((location && location.country) || countrySelect.dataset.selectedValue || '').trim();
        const city = String((location && location.city) || citySelect.dataset.selectedValue || '').trim();
        populateCountryOptions(countrySelect, country, country);
        ensureSelectOption(countrySelect, country, country);
        countrySelect.value = country;
        populateCityOptions(citySelect, country, city, city);
    };

    const readWeatherLocationLabel = function (location) {
        if (!location) {
            return '';
        }
        return String(location.label || location.location_label || location.name || [location.city, location.country].filter(Boolean).join(' · ')).trim();
    };

    const syncWeatherLocationClearButton = function (input) {
        if (!input || !input.closest) {
            return;
        }
        const wrap = input.closest('[data-auth-account-weather-location-search-wrap]');
        const clearButton = wrap ? wrap.querySelector('[data-auth-account-weather-location-clear]') : null;
        if (clearButton) {
            clearButton.hidden = !String(input.value || '').length;
        }
    };

    const setWeatherSelectedLocation = function (widget, location) {
        const input = widget.querySelector('[data-auth-account-weather-location-search]');
        if (!input) {
            return;
        }
        const nextLocation = location || {};
        const label = readWeatherLocationLabel(nextLocation);
        input.value = label;
        input.dataset.selectedLabel = label;
        input.dataset.selectedCountry = String(nextLocation.country || '').trim();
        input.dataset.selectedCity = String(nextLocation.city || '').trim();
        input.dataset.selectedLatitude = nextLocation.latitude !== undefined && nextLocation.latitude !== null
            ? String(nextLocation.latitude)
            : '';
        input.dataset.selectedLongitude = nextLocation.longitude !== undefined && nextLocation.longitude !== null
            ? String(nextLocation.longitude)
            : '';
        syncWeatherLocationClearButton(input);
    };

    const clearWeatherSelectedLocation = function (input) {
        if (!input) {
            return;
        }
        input.dataset.selectedLabel = '';
        input.dataset.selectedCountry = '';
        input.dataset.selectedCity = '';
        input.dataset.selectedLatitude = '';
        input.dataset.selectedLongitude = '';
        syncWeatherLocationClearButton(input);
    };

    const readWeatherSelectedLocation = function (input) {
        if (!input) {
            return null;
        }
        const latitude = String(input.dataset.selectedLatitude || '').trim();
        const longitude = String(input.dataset.selectedLongitude || '').trim();
        if (!latitude || !longitude) {
            return null;
        }
        return {
            label: String(input.dataset.selectedLabel || input.value || '').trim(),
            country: String(input.dataset.selectedCountry || '').trim(),
            city: String(input.dataset.selectedCity || '').trim(),
            latitude: latitude,
            longitude: longitude
        };
    };

    const setWeatherLocationResultsOpen = function (widget, opened) {
        const input = widget.querySelector('[data-auth-account-weather-location-search]');
        const results = widget.querySelector('[data-auth-account-weather-location-results]');
        if (input) {
            input.setAttribute('aria-expanded', opened ? 'true' : 'false');
        }
        if (results) {
            results.hidden = !opened;
        }
    };

    const renderWeatherLocationResults = function (widget, locations, message) {
        const results = widget.querySelector('[data-auth-account-weather-location-results]');
        if (!results) {
            return;
        }
        results.textContent = '';
        if (!Array.isArray(locations) || !locations.length) {
            if (message) {
                const empty = document.createElement('div');
                empty.className = 'ui-auth-account-weather-location-empty';
                empty.textContent = message;
                results.appendChild(empty);
                setWeatherLocationResultsOpen(widget, true);
                return;
            }
            setWeatherLocationResultsOpen(widget, false);
            return;
        }
        locations.forEach(function (location) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ui-auth-account-weather-location-option';
            button.setAttribute('role', 'option');
            button.textContent = readWeatherLocationLabel(location);
            button.addEventListener('click', function () {
                setWeatherSelectedLocation(widget, location);
                setWeatherLocationResultsOpen(widget, false);
            });
            results.appendChild(button);
        });
        setWeatherLocationResultsOpen(widget, true);
    };

    const getCsrfToken = function () {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : '';
    };

    const closeAccountMenu = function (widget) {
        let accountHost = widget.closest('[data-auth-account]');
        if (!accountHost && document.body.classList.contains('root-page')) {
            const rootAccount = document.getElementById('ui-auth-account-root');
            accountHost = rootAccount ? rootAccount.querySelector('[data-auth-account]') : null;
        }
        if (!accountHost) {
            return;
        }
        const accountMenu = accountHost.querySelector('[data-auth-account-menu]');
        const accountTrigger = accountHost.querySelector('[data-auth-account-trigger]');
        if (accountMenu) {
            accountMenu.hidden = true;
        }
        if (accountTrigger) {
            accountTrigger.setAttribute('aria-expanded', 'false');
        }
    };

    const setPopupOpen = function (widget, opened) {
        const trigger = widget.querySelector('[data-auth-account-weather-trigger]');
        const popup = widget.querySelector('[data-auth-account-weather-popup]');
        if (!trigger || !popup) {
            return;
        }
        if (opened) {
            widgets.forEach(function (otherWidget) {
                if (otherWidget !== widget) {
                    setPopupOpen(otherWidget, false);
                }
            });
            closeAccountMenu(widget);
        }
        popup.hidden = !opened;
        trigger.setAttribute('aria-expanded', opened ? 'true' : 'false');
        if (!opened) {
            setSettingsOpen(widget, false);
        }
    };

    const setSettingsOpen = function (widget, opened) {
        const form = widget.querySelector('[data-auth-account-weather-form]');
        const card = widget.querySelector('[data-auth-account-weather-card]');
        const toggle = widget.querySelector('[data-auth-account-weather-settings-toggle]');
        if (form) {
            form.hidden = !opened;
        }
        if (card) {
            card.hidden = Boolean(opened);
        }
        if (toggle) {
            toggle.setAttribute('aria-expanded', opened ? 'true' : 'false');
        }
    };

    const setStatus = function (widget, message, isError) {
        const status = widget.querySelector('[data-auth-account-weather-status]');
        if (!status) {
            return;
        }
        status.textContent = String(message || '').trim();
        status.hidden = !status.textContent;
        status.classList.toggle('is-error', Boolean(isError));
    };

    const setBusy = function (widget, busy) {
        const controls = Array.from(widget.querySelectorAll('button, input, select'));
        controls.forEach(function (control) {
            control.disabled = Boolean(busy);
        });
    };

    const readPayloadError = function (payload, fallback) {
        if (payload && typeof payload === 'object') {
            return String(payload.error_message || payload.error || fallback || '').trim();
        }
        return String(fallback || '').trim();
    };

    const setWeatherIconType = function (element, iconType) {
        if (!element) {
            return;
        }
        Array.from(element.classList).forEach(function (className) {
            if (className.indexOf('is-') === 0) {
                element.classList.remove(className);
            }
        });
        element.classList.add('is-' + (String(iconType || '').trim() || 'unknown'));
    };

    const setWeatherWidgetVisible = function (widget, visible) {
        widget.hidden = !visible;
    };

    const splitWeatherTemperatureRangeLabel = function (rangeLabel) {
        const parts = String(rangeLabel || '').split('/').map(function (part) {
            return part.trim();
        }).filter(Boolean);
        return {
            low: parts.length > 1 ? parts[0] : '',
            high: parts.length > 1 ? parts[1] : (parts[0] || '')
        };
    };

    const ensureWeatherTriggerRangeParts = function (range) {
        if (!range) {
            return { high: null, low: null };
        }
        let high = range.querySelector('[data-auth-account-weather-range-high]');
        let low = range.querySelector('[data-auth-account-weather-range-low]');
        if (!high || !low) {
            range.textContent = '';
            high = document.createElement('span');
            high.className = 'ui-auth-account-weather-chip-range-high';
            high.setAttribute('data-auth-account-weather-range-high', '');
            low = document.createElement('span');
            low.className = 'ui-auth-account-weather-chip-range-low';
            low.setAttribute('data-auth-account-weather-range-low', '');
            range.append(high, low);
        }
        return { high: high, low: low };
    };

    const setWeatherTriggerRange = function (range, day) {
        const parts = ensureWeatherTriggerRangeParts(range);
        if (!parts.high || !parts.low) {
            return;
        }
        const fallback = splitWeatherTemperatureRangeLabel(day && day.temperature_range_label);
        const highLabel = String((day && day.temperature_max_label) || fallback.high || '').trim();
        const lowLabel = String((day && day.temperature_min_label) || fallback.low || '').trim();
        parts.high.textContent = highLabel;
        parts.low.textContent = lowLabel;
        range.hidden = !(highLabel || lowLabel);
        range.setAttribute('aria-label', [highLabel, lowLabel].filter(Boolean).join(' / '));
    };

    const syncWeatherTriggerIcons = function (widget, firstIconType, secondIconType) {
        const firstIcon = widget.querySelector('[data-auth-account-weather-am-icon]');
        const secondIcon = widget.querySelector('[data-auth-account-weather-pm-icon]');
        const iconHost = firstIcon && firstIcon.closest ? firstIcon.closest('.ui-auth-account-weather-chip-icons') : null;
        const firstPeriod = firstIcon && firstIcon.closest ? firstIcon.closest('.ui-auth-account-weather-chip-period') : null;
        const secondPeriod = secondIcon && secondIcon.closest ? secondIcon.closest('.ui-auth-account-weather-chip-period') : null;
        const firstType = String(firstIconType || '').trim() || 'unknown';
        const secondType = String(secondIconType || firstType).trim() || firstType;
        const isSingleIcon = firstType === secondType;
        setWeatherIconType(firstIcon, firstType);
        setWeatherIconType(secondIcon, secondType);
        if (firstPeriod) {
            firstPeriod.hidden = false;
        }
        if (secondPeriod) {
            secondPeriod.hidden = isSingleIcon;
        }
        if (iconHost) {
            iconHost.classList.toggle('is-single-icon', isSingleIcon);
        }
    };

    const renderUnavailableWeather = function (widget, message) {
        const day = widget.querySelector('[data-auth-account-weather-day]');
        const range = widget.querySelector('[data-auth-account-weather-range]');
        const location = widget.querySelector('[data-auth-account-weather-location]');
        const cardDay = widget.querySelector('[data-auth-account-weather-card-day]');
        const cardRange = widget.querySelector('[data-auth-account-weather-card-range]');
        const cardCondition = widget.querySelector('[data-auth-account-weather-card-condition]');
        const cardDetails = widget.querySelector('[data-auth-account-weather-card-details]');
        const periodsHost = widget.querySelector('[data-auth-account-weather-periods]');
        const dailyHost = widget.querySelector('[data-auth-account-weather-daily]');
        const unsetLabel = String(widget.dataset.weatherUnsetLabel || 'Set weather').trim();
        const fallback = String(message || widget.dataset.weatherErrorLabel || unsetLabel).trim();

        if (day) {
            day.textContent = unsetLabel;
        }
        if (range) {
            setWeatherTriggerRange(range, null);
        }
        syncWeatherTriggerIcons(widget, 'unknown', 'unknown');
        if (location) {
            location.textContent = unsetLabel;
        }
        if (cardDay) {
            cardDay.textContent = '';
        }
        if (cardRange) {
            cardRange.textContent = '';
        }
        if (cardCondition) {
            cardCondition.textContent = fallback;
        }
        if (cardDetails) {
            cardDetails.textContent = '';
        }
        setWeatherIconType(widget.querySelector('[data-auth-account-weather-card-icon]'), 'unknown');
        if (periodsHost) {
            periodsHost.textContent = '';
        }
        if (dailyHost) {
            dailyHost.textContent = '';
        }
    };

    const createWeatherPeriodElement = function (period) {
        period = period || {};
        const item = document.createElement('div');
        item.className = 'ui-auth-account-weather-card-period';
        item.setAttribute('aria-label', [period.label, period.weather_label, period.temperature_label].filter(Boolean).join(' '));

        const label = document.createElement('span');
        label.className = 'ui-auth-account-weather-card-period-label';
        label.textContent = String(period.label || '').trim();

        const icon = document.createElement('span');
        icon.className = 'ui-auth-account-weather-symbol';
        icon.setAttribute('aria-hidden', 'true');
        setWeatherIconType(icon, period.icon_type);

        const temperature = document.createElement('strong');
        temperature.className = 'ui-auth-account-weather-card-period-temp';
        temperature.textContent = String(period.temperature_label || '').trim();

        item.append(label, icon, temperature);
        return item;
    };

    const renderWeatherDetails = function (host, detailItems) {
        if (!host) {
            return;
        }
        host.textContent = '';
        (Array.isArray(detailItems) ? detailItems : []).forEach(function (item) {
            const labelText = String(item && item.label || '').trim();
            const valueText = String(item && item.value_label || '').trim();
            if (!labelText || !valueText) {
                return;
            }
            const row = document.createElement('span');
            row.className = 'ui-auth-account-weather-card-detail';

            const label = document.createElement('span');
            label.className = 'ui-auth-account-weather-card-detail-label';
            label.textContent = labelText + ':';

            const value = document.createElement('strong');
            value.className = 'ui-auth-account-weather-card-detail-value';
            value.textContent = valueText;

            row.append(label, value);
            host.appendChild(row);
        });
    };

    const getHourlyForecastForDate = function (payload, date) {
        const selectedDate = String(date || '').trim();
        const currentForecastDate = String(payload && payload.current_forecast_date || '').trim();
        if (selectedDate && selectedDate === currentForecastDate && Array.isArray(payload && payload.hourly_forecast)) {
            return payload.hourly_forecast.slice(0, 24);
        }
        const hourlyByDate = payload && payload.hourly_forecast_by_date && typeof payload.hourly_forecast_by_date === 'object'
            ? payload.hourly_forecast_by_date
            : {};
        if (selectedDate && Array.isArray(hourlyByDate[selectedDate])) {
            return hourlyByDate[selectedDate];
        }
        if (Array.isArray(payload && payload.hourly_forecast)) {
            return payload.hourly_forecast.slice(0, 24);
        }
        if (Array.isArray(payload && payload.periods)) {
            return payload.periods.slice(0, 24);
        }
        return [];
    };

    const getCalendarHourlyForecastForDate = function (payload, date) {
        const selectedDate = String(date || payload && payload.current_forecast_date || '').trim();
        const hourlyByDate = payload && payload.hourly_forecast_by_date && typeof payload.hourly_forecast_by_date === 'object'
            ? payload.hourly_forecast_by_date
            : {};
        if (selectedDate && Array.isArray(hourlyByDate[selectedDate])) {
            return hourlyByDate[selectedDate];
        }
        if (Array.isArray(payload && payload.hourly_forecast)) {
            return payload.hourly_forecast.slice(0, 24);
        }
        if (Array.isArray(payload && payload.periods)) {
            return payload.periods.slice(0, 24);
        }
        return [];
    };

    const renderWeatherPeriods = function (host, hourlyForecast) {
        if (!host) {
            return;
        }
        host.textContent = '';
        (Array.isArray(hourlyForecast) ? hourlyForecast : []).forEach(function (period) {
            host.appendChild(createWeatherPeriodElement(period));
        });
    };

    const formatWeatherDateLabel = function (day) {
        day = day || {};
        const dateText = String(day.date || '').trim();
        const weekday = String(day.weekday || '').trim();
        const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            return weekday || dateText;
        }
        const dateLabel = isEnglishUi()
            ? `${match[1]}-${match[2]}-${match[3]}`
            : `${Number(match[1])}. ${Number(match[2])}. ${Number(match[3])}.`;
        return [dateLabel, weekday].filter(Boolean).join(' ');
    };

    const formatWeatherMonthDayLabel = function (day) {
        const dateText = String(day && day.date || '').trim();
        const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) {
            return '';
        }
        return `${Number(match[2])}.${Number(match[3])}`;
    };

    const formatWeatherSubtitle = function (payload, day) {
        return formatWeatherDateLabel(day);
    };

    const getWeatherIconPriority = function (iconType) {
        switch (String(iconType || '').trim()) {
        case 'storm':
            return 6;
        case 'snow':
            return 5;
        case 'rain':
            return 4;
        case 'fog':
            return 3;
        case 'cloudy':
            return 2;
        case 'partly-cloudy':
            return 1;
        case 'clear':
            return 0;
        default:
            return -1;
        }
    };

    const getWeatherPeriodHour = function (period, fallbackIndex) {
        const timeText = String(period && period.time || '').trim();
        const match = timeText.match(/T(\d{2}):/);
        if (match) {
            return Number(match[1]);
        }
        return fallbackIndex;
    };

    const getRepresentativeWeatherIcon = function (hourlyForecast, startHour, endHour, fallbackIconType) {
        let selectedIconType = '';
        let selectedPriority = -2;
        (Array.isArray(hourlyForecast) ? hourlyForecast : []).forEach(function (period, index) {
            const hour = getWeatherPeriodHour(period, index);
            if (!Number.isFinite(hour) || hour < startHour || hour > endHour) {
                return;
            }
            const iconType = String(period && period.icon_type || '').trim();
            const priority = getWeatherIconPriority(iconType);
            if (priority > selectedPriority) {
                selectedIconType = iconType;
                selectedPriority = priority;
            }
        });
        return selectedIconType || String(fallbackIconType || '').trim() || 'unknown';
    };

    const getWeatherTriggerIconTypes = function (hourlyForecast, fallbackIconType) {
        return {
            first: getRepresentativeWeatherIcon(hourlyForecast, 0, 11, fallbackIconType),
            second: getRepresentativeWeatherIcon(hourlyForecast, 12, 23, fallbackIconType)
        };
    };

    const syncWeatherDailySelection = function (widget, date) {
        const selectedDate = String(date || '').trim();
        Array.from(widget.querySelectorAll('[data-auth-account-weather-day-date]')).forEach(function (row) {
            const isActive = row.getAttribute('data-auth-account-weather-day-date') === selectedDate;
            row.classList.toggle('is-active', isActive);
            row.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    };

    const activateWeatherDay = function (widget, payload, day) {
        day = day || {};
        const selectedDate = String(day.date || '').trim();
        const hourlyForecast = getHourlyForecastForDate(payload, selectedDate);
        const cardDay = widget.querySelector('[data-auth-account-weather-card-day]');
        const cardRange = widget.querySelector('[data-auth-account-weather-card-range]');
        const cardCondition = widget.querySelector('[data-auth-account-weather-card-condition]');
        const cardDetails = widget.querySelector('[data-auth-account-weather-card-details]');
        const periodsHost = widget.querySelector('[data-auth-account-weather-periods]');
        if (cardDay) {
            cardDay.textContent = formatWeatherSubtitle(payload, day) || String(day.weekday || '').trim();
        }
        if (cardRange) {
            cardRange.textContent = String(day.temperature_range_label || '').trim();
        }
        if (cardCondition) {
            cardCondition.textContent = String(day.weather_label || payload.summary || '').trim();
        }
        renderWeatherDetails(cardDetails, day.detail_items);
        setWeatherIconType(widget.querySelector('[data-auth-account-weather-card-icon]'), day.icon_type);
        renderWeatherPeriods(periodsHost, hourlyForecast);
        syncWeatherDailySelection(widget, selectedDate);
    };

    const createWeatherDailyElement = function (widget, payload, day) {
        day = day || {};
        const forecastDate = String(day.date || '').trim();
        const dailyIconTypes = getWeatherTriggerIconTypes(getCalendarHourlyForecastForDate(payload, forecastDate), day.icon_type);
        const monthDayLabel = formatWeatherMonthDayLabel(day);
        const item = document.createElement('div');
        item.className = 'ui-auth-account-weather-card-day-row';
        item.setAttribute('role', 'button');
        item.setAttribute('tabindex', '0');
        item.setAttribute('aria-selected', 'false');
        item.setAttribute('data-auth-account-weather-day-date', forecastDate);

        const date = document.createElement('span');
        date.className = 'ui-auth-account-weather-card-day-date';
        date.textContent = monthDayLabel;

        const label = document.createElement('span');
        label.className = 'ui-auth-account-weather-card-day-label';
        label.textContent = String(day.weekday_short || day.weekday || '').trim();

        const icons = document.createElement('span');
        icons.className = 'ui-auth-account-weather-card-day-icons';
        icons.setAttribute('aria-hidden', 'true');

        const amIcon = document.createElement('span');
        amIcon.className = 'ui-auth-account-weather-symbol ui-auth-account-weather-card-day-icon';
        setWeatherIconType(amIcon, dailyIconTypes.first);

        const pmIcon = document.createElement('span');
        pmIcon.className = 'ui-auth-account-weather-symbol ui-auth-account-weather-card-day-icon';
        setWeatherIconType(pmIcon, dailyIconTypes.second);
        icons.append(amIcon, pmIcon);

        const condition = document.createElement('span');
        condition.className = 'ui-auth-account-weather-card-day-condition';
        condition.textContent = String(day.weather_label || '').trim();

        const precipitation = document.createElement('span');
        precipitation.className = 'ui-auth-account-weather-card-day-precipitation';
        precipitation.textContent = String(day.precipitation_probability_label || '').trim();

        const range = document.createElement('strong');
        range.className = 'ui-auth-account-weather-card-day-range';
        range.textContent = String(day.temperature_range_label || '').trim();

        item.setAttribute('aria-label', [
            monthDayLabel,
            day.weekday || day.weekday_short,
            day.weather_label,
            day.precipitation_probability_label,
            day.temperature_range_label
        ].filter(Boolean).join(' '));
        item.addEventListener('click', function () {
            activateWeatherDay(widget, payload, day);
        });
        item.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            activateWeatherDay(widget, payload, day);
        });

        item.append(date, label, icons, condition, precipitation, range);
        return item;
    };

    const renderWeather = function (widget, payload) {
        if (!payload || payload.ok !== true) {
            renderUnavailableWeather(widget);
            setWeatherWidgetVisible(widget, true);
            return;
        }

        const location = payload.location || {};
        syncLocationSelects(widget, location);
        const locationName = String(payload.location_name || [location.city, location.country].filter(Boolean).join(' · ')).trim();
        setWeatherSelectedLocation(widget, {
            label: locationName,
            country: location.country,
            city: location.city,
            latitude: location.latitude,
            longitude: location.longitude
        });
        const day = payload.day || {};
        const dailyForecast = Array.isArray(payload.daily_forecast) ? payload.daily_forecast : [];
        const triggerIconTypes = getWeatherTriggerIconTypes(getCalendarHourlyForecastForDate(payload, day.date), day.icon_type);
        const dayLabel = String(day.weekday_short || day.weekday || '').trim();

        const triggerDay = widget.querySelector('[data-auth-account-weather-day]');
        const triggerRange = widget.querySelector('[data-auth-account-weather-range]');
        if (triggerDay) {
            triggerDay.textContent = dayLabel || '--';
        }
        if (triggerRange) {
            setWeatherTriggerRange(triggerRange, day);
        }
        syncWeatherTriggerIcons(widget, triggerIconTypes.first, triggerIconTypes.second);

        const popupLocation = widget.querySelector('[data-auth-account-weather-location]');
        const dailyHost = widget.querySelector('[data-auth-account-weather-daily]');
        if (popupLocation) {
            popupLocation.textContent = locationName || String(widget.dataset.weatherUnsetLabel || 'Set weather').trim();
        }
        if (dailyHost) {
            dailyHost.textContent = '';
            dailyForecast.forEach(function (forecastDay) {
                dailyHost.appendChild(createWeatherDailyElement(widget, payload, forecastDay));
            });
        }
        activateWeatherDay(widget, payload, day);
        setWeatherWidgetVisible(widget, true);
    };

    const requestWeather = async function (widget, options) {
        const url = String(widget.dataset.weatherUrl || '').trim();
        if (!url) {
            return null;
        }
        const method = options && options.method ? options.method : 'GET';
        const headers = {
            Accept: 'application/json'
        };
        const requestOptions = {
            method: method,
            credentials: 'same-origin',
            headers: headers
        };
        if (method !== 'GET') {
            headers['Content-Type'] = 'application/json';
            headers['X-CSRFToken'] = getCsrfToken();
            requestOptions.body = JSON.stringify((options && options.body) || {});
        }
        const response = await fetch(url, requestOptions);
        const payload = await response.json().catch(function () {
            return {};
        });
        if (!response.ok) {
            throw new Error(readPayloadError(payload, widget.dataset.weatherErrorLabel));
        }
        return payload;
    };

    const requestWeatherLocations = async function (widget, query) {
        const baseUrl = String(widget.dataset.weatherLocationSearchUrl || '').trim();
        if (!baseUrl) {
            return [];
        }
        const url = baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + 'q=' + encodeURIComponent(query);
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json'
            }
        });
        const payload = await response.json().catch(function () {
            return {};
        });
        if (!response.ok) {
            throw new Error(readPayloadError(payload, widget.dataset.weatherErrorLabel));
        }
        return Array.isArray(payload.results) ? payload.results : [];
    };

    const loadWeather = async function (widget) {
        const loadingLabel = String(widget.dataset.weatherLoadingLabel || 'Loading weather').trim();
        setWeatherWidgetVisible(widget, false);
        renderUnavailableWeather(widget, loadingLabel);
        try {
            const payload = await requestWeather(widget);
            renderWeather(widget, payload);
            setStatus(widget, '', false);
        } catch (error) {
            renderUnavailableWeather(widget);
            setWeatherWidgetVisible(widget, true);
            setStatus(widget, error && error.message, true);
        }
    };

    const saveWeather = async function (widget, body) {
        const loadingLabel = String(widget.dataset.weatherLoadingLabel || 'Loading weather').trim();
        setBusy(widget, true);
        setStatus(widget, loadingLabel, false);
        try {
            const payload = await requestWeather(widget, {
                method: 'PATCH',
                body: body
            });
            renderWeather(widget, payload);
            setStatus(widget, '', false);
            setSettingsOpen(widget, false);
        } catch (error) {
            setStatus(widget, error && error.message, true);
        } finally {
            setBusy(widget, false);
        }
    };

    const bindWidget = function (widget) {
        const trigger = widget.querySelector('[data-auth-account-weather-trigger]');
        const popup = widget.querySelector('[data-auth-account-weather-popup]');
        const closeButton = widget.querySelector('[data-auth-account-weather-close]');
        const settingsToggle = widget.querySelector('[data-auth-account-weather-settings-toggle]');
        const form = widget.querySelector('[data-auth-account-weather-form]');
        const resetButton = widget.querySelector('[data-auth-account-weather-reset]');
        const locationInput = widget.querySelector('[data-auth-account-weather-location-search]');
        const locationClearButton = widget.querySelector('[data-auth-account-weather-location-clear]');
        let locationSearchTimer = null;
        let locationSearchToken = 0;

        syncLocationSelects(widget, null);
        syncWeatherLocationClearButton(locationInput);

        if (trigger) {
            trigger.addEventListener('click', function (event) {
                event.preventDefault();
                setPopupOpen(widget, !(popup && !popup.hidden));
            });
        }

        if (settingsToggle) {
            settingsToggle.addEventListener('click', function (event) {
                event.preventDefault();
                const expanded = settingsToggle.getAttribute('aria-expanded') === 'true';
                setSettingsOpen(widget, !expanded);
            });
        }

        if (closeButton) {
            closeButton.addEventListener('click', function () {
                setPopupOpen(widget, false);
            });
        }

        if (form) {
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                const selectedLocation = readWeatherSelectedLocation(locationInput);
                if (selectedLocation) {
                    saveWeather(widget, selectedLocation);
                    return;
                }
                saveWeather(widget, {
                    query: locationInput ? locationInput.value : ''
                });
            });
        }

        if (locationInput) {
            locationInput.addEventListener('input', function () {
                clearWeatherSelectedLocation(locationInput);
                syncWeatherLocationClearButton(locationInput);
                const query = String(locationInput.value || '').trim();
                window.clearTimeout(locationSearchTimer);
                if (query.length < 2) {
                    renderWeatherLocationResults(widget, []);
                    return;
                }
                const requestToken = locationSearchToken + 1;
                locationSearchToken = requestToken;
                locationSearchTimer = window.setTimeout(function () {
                    requestWeatherLocations(widget, query)
                        .then(function (locations) {
                            if (requestToken !== locationSearchToken) {
                                return;
                            }
                            renderWeatherLocationResults(
                                widget,
                                locations,
                                locations.length ? '' : (widget.dataset.weatherNoLocationResultsLabel || '')
                            );
                        })
                        .catch(function (error) {
                            if (requestToken !== locationSearchToken) {
                                return;
                            }
                            renderWeatherLocationResults(widget, [], error && error.message);
                        });
                }, 220);
            });
            locationInput.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    setWeatherLocationResultsOpen(widget, false);
                }
            });
        }

        if (locationClearButton && locationInput) {
            locationClearButton.addEventListener('click', function () {
                locationInput.value = '';
                clearWeatherSelectedLocation(locationInput);
                locationSearchToken += 1;
                window.clearTimeout(locationSearchTimer);
                renderWeatherLocationResults(widget, []);
                setWeatherLocationResultsOpen(widget, false);
                locationInput.focus();
            });
        }

        if (resetButton) {
            resetButton.addEventListener('click', function () {
                if (locationInput) {
                    locationInput.value = '';
                    clearWeatherSelectedLocation(locationInput);
                    syncWeatherLocationClearButton(locationInput);
                }
                renderWeatherLocationResults(widget, []);
                saveWeather(widget, { use_ip: true });
            });
        }

        loadWeather(widget);
    };

    const isWeatherCustomSelectTarget = function (widget, target) {
        const option = target && target.closest ? target.closest('.site-custom-select-option') : null;
        const menu = option ? option.closest('.site-custom-select-menu') : null;
        if (!menu || !menu.id) {
            return false;
        }
        return Array.from(widget.querySelectorAll('.ui-auth-account-weather-select')).some(function (select) {
            return select.dataset && select.dataset.siteCustomSelectMenuId === menu.id;
        });
    };

    widgets.forEach(bindWidget);

    document.addEventListener('click', function (event) {
        const target = event.target;
        widgets.forEach(function (widget) {
            const popup = widget.querySelector('[data-auth-account-weather-popup]');
            if (!popup || popup.hidden || widget.contains(target) || isWeatherCustomSelectTarget(widget, target)) {
                return;
            }
            setPopupOpen(widget, false);
        });
    });

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') {
            return;
        }
        widgets.forEach(function (widget) {
            setPopupOpen(widget, false);
        });
    });
})();
