// Shared portfolio chat widget entry. This file owns widget boot, anchoring, persistence, and request flow.
document.addEventListener('DOMContentLoaded', function() {
    // Storage and history limits keep the floating widget responsive without letting old sessions grow forever.
    const CHAT_HISTORY_LIMIT = 30;
    const CHAT_REQUEST_HISTORY_LIMIT = 20;
    const LOADING_DOT_ANIMATION_INTERVAL_MS = 300;
    const DEFAULT_WIDGET_BOTTOM_PX = 20;
    const htmlLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    const uiLang = htmlLang.startsWith('en') ? 'en' : 'ko';
    const pathLangMatch = (window.location.pathname || '').match(/^\/(ko|en)(\/|$)/);
    const chatApiUrl = pathLangMatch ? `/${pathLangMatch[1]}/api/chat/` : '/api/chat/';
    const i18nByLang = {
        ko: {
            initialBotMessage: '안녕하세요! 궁금하신 점이 있으시면 언제든지 물어보세요.',
            chatTitle: '챗봇과 대화하기',
            inputPlaceholder: '메시지를 입력하세요...',
            responseProcessingError: '응답을 처리하는 중 오류가 발생했습니다.',
            csrfMissingError: '오류: CSRF 토큰을 찾을 수 없습니다. 페이지를 새로고침 해주세요.',
            genericError: '죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            serverCommunicationError: '죄송합니다. 서버와의 통신 중 오류가 발생했습니다.',
            apiRequestFailed: 'API 요청 실패'
        },
        en: {
            initialBotMessage: 'Hello! Feel free to ask me anything.',
            chatTitle: 'Chat with Chatbot',
            inputPlaceholder: 'Type your message...',
            responseProcessingError: 'An error occurred while processing the response.',
            csrfMissingError: 'Error: CSRF token not found. Please refresh the page.',
            genericError: 'Sorry, an error occurred. Please try again shortly.',
            serverCommunicationError: 'Sorry, a communication error occurred with the server.',
            apiRequestFailed: 'API request failed'
        }
    };
    const i18n = i18nByLang[uiLang];
    const selectServerMessage = function(payload, fallback) {
        if (!payload || typeof payload !== 'object') {
            return fallback || '';
        }
        const messages = payload.error_messages || payload.messages;
        if (messages && typeof messages === 'object') {
            return messages[uiLang] || messages.ko || messages.en || fallback || '';
        }
        return payload.error_message || payload.message || payload.error || fallback || '';
    };
    const initialBotMessage = i18n.initialBotMessage;
    const STORAGE_KEY = 'portfolio_chat_history_v1';
    const conversationHistory = [];

    // 채팅 위젯 요소 생성
    const chatWidget = document.createElement('div');
    chatWidget.className = 'chat-widget';
    chatWidget.innerHTML = `
        <div class="chat-header">
            <h3>${i18n.chatTitle}</h3>
            <button class="chat-toggle">−</button>
        </div>
        <div class="chat-body">
            <div class="chat-messages" id="chat-messages"></div>
            <div class="chat-input">
                <input type="text" id="user-input" placeholder="${i18n.inputPlaceholder}" autocomplete="off">
                <button id="send-button">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                </button>
            </div>
        </div>
    `;

    // 문서에 채팅 위젯 추가
    document.body.appendChild(chatWidget);

    // 요소 참조
    const chatToggle = chatWidget.querySelector('.chat-toggle');
    const chatBody = chatWidget.querySelector('.chat-body');
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const portfolioOwnerUsername = String(document.body.getAttribute('data-portfolio-owner-username') || '').trim();
    const footer = document.querySelector('.foot');
    const printButton = document.querySelector('[data-portfolio-print]');
    const ownPortfolioEditWidget = document.querySelector('.own-portfolio-edit-widget');
    // Floating utility buttons are laid out as one anchored cluster relative to the chat widget.
    const widgetAnchorButtons = [];
    if (printButton) {
        widgetAnchorButtons.push(printButton);
    }
    const extraWidgetAnchorButtons = Array.from(document.querySelectorAll('[data-chat-widget-anchor]'));
    extraWidgetAnchorButtons.forEach(function(button) {
        if (!widgetAnchorButtons.includes(button)) {
            widgetAnchorButtons.push(button);
        }
    });
    widgetAnchorButtons.sort(function(a, b) {
        const orderA = Number.parseInt(a.getAttribute('data-chat-widget-anchor-order') || '0', 10) || 0;
        const orderB = Number.parseInt(b.getAttribute('data-chat-widget-anchor-order') || '0', 10) || 0;
        return orderA - orderB;
    });
    const footerClearance = 0;
    const printButtonGap = -44;
    const printButtonLeftOffset = 5;
    const anchorButtonsSpacing = 8;
    const computedBottom = parseFloat(window.getComputedStyle(chatWidget).bottom || String(DEFAULT_WIDGET_BOTTOM_PX));
    const widgetBaseBottom = Number.isNaN(computedBottom) ? DEFAULT_WIDGET_BOTTOM_PX : computedBottom;
    const widgetMotionFollowDurationMs = 420;
    // RAF ids let scroll/resize work coalesce into one layout update per frame.
    let footerOffsetRafId = null;
    let printButtonAnchorRafId = null;
    let widgetMotionFollowRafId = null;
    let widgetMotionFollowUntil = 0;

    // 인쇄 버튼 앵커 위치를 업데이트하는 함수
    function updatePrintButtonAnchor() {
        // Anchor buttons are positioned from the live widget rect so they move with
        // the widget when footer avoidance or open/close animation changes its position.
        printButtonAnchorRafId = null;

        if (!widgetAnchorButtons.length) {
            if (ownPortfolioEditWidget) {
                ownPortfolioEditWidget.classList.remove('is-chat-widget-anchor');
                ownPortfolioEditWidget.style.left = '';
                ownPortfolioEditWidget.style.top = '';
            }
            return;
        }

        const widgetRect = chatWidget.getBoundingClientRect();
        const minViewportInset = 8;
        const buttonWidths = [];
        const buttonHeights = [];

        widgetAnchorButtons.forEach(function(button) {
            button.classList.add('is-chat-widget-anchor');
            const rect = button.getBoundingClientRect();
            buttonWidths.push(rect.width);
            buttonHeights.push(rect.height);
        });

        const groupWidth = buttonWidths.reduce(function(total, width) {
            return total + width;
        }, 0) + Math.max(0, widgetAnchorButtons.length - 1) * anchorButtonsSpacing;
        const maxButtonHeight = buttonHeights.reduce(function(maxHeight, currentHeight) {
            return Math.max(maxHeight, currentHeight);
        }, 0);

        const maxGroupLeft = Math.max(minViewportInset, window.innerWidth - groupWidth - minViewportInset);
        const groupLeft = Math.min(
            Math.max(minViewportInset, widgetRect.left + printButtonLeftOffset),
            maxGroupLeft
        );
        const groupTop = Math.max(minViewportInset, widgetRect.top - maxButtonHeight - printButtonGap);

        let currentLeft = groupLeft;
        widgetAnchorButtons.forEach(function(button, index) {
            const buttonHeight = buttonHeights[index] || maxButtonHeight;
            const alignedTop = groupTop + (maxButtonHeight - buttonHeight);
            button.style.left = `${currentLeft}px`;
            button.style.top = `${alignedTop}px`;
            currentLeft += (buttonWidths[index] || 0) + anchorButtonsSpacing;
        });

        if (ownPortfolioEditWidget) {
            ownPortfolioEditWidget.classList.add('is-chat-widget-anchor');

            const editRect = ownPortfolioEditWidget.getBoundingClientRect();
            const maxEditLeft = Math.max(minViewportInset, window.innerWidth - editRect.width - minViewportInset);
            const editLeft = Math.min(Math.max(minViewportInset, widgetRect.right - editRect.width), maxEditLeft);
            const editTop = Math.max(minViewportInset, widgetRect.top - editRect.height - anchorButtonsSpacing);

            ownPortfolioEditWidget.style.left = `${Math.round(editLeft)}px`;
            ownPortfolioEditWidget.style.top = `${Math.round(editTop)}px`;
        }
    }

    // 인쇄 버튼 앵커 업데이트를 스케줄링하는 함수
    function schedulePrintButtonAnchorUpdate() {
        // Coalesce repeated anchor recalculations into one RAF to avoid layout churn.
        if (!widgetAnchorButtons.length || printButtonAnchorRafId !== null) {
            return;
        }

        printButtonAnchorRafId = window.requestAnimationFrame(updatePrintButtonAnchor);
    }

    // 채팅 위젯 하단 오프셋을 업데이트하는 함수
    function updateChatWidgetBottomOffset() {
        // The widget lifts above the footer when the footer is visible, but otherwise
        // returns to its configured resting offset from the viewport bottom.
        footerOffsetRafId = null;

        if (!footer) {
            chatWidget.style.bottom = `${widgetBaseBottom}px`;
            schedulePrintButtonAnchorUpdate();
            return;
        }

        const footerRect = footer.getBoundingClientRect();
        const visibleFooterHeight = Math.max(0, window.innerHeight - footerRect.top);
        const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
        const viewportBottom = scrollTop + window.innerHeight;
        const pageBottom = Math.max(
            document.documentElement.scrollHeight,
            document.body ? document.body.scrollHeight : 0
        );
        const isAtPageBottom = viewportBottom >= (pageBottom - 2);
        const footerDrivenBottom = Math.max(0, visibleFooterHeight + footerClearance);
        const targetBottom = isAtPageBottom
            ? footerDrivenBottom
            : Math.max(widgetBaseBottom, footerDrivenBottom);

        chatWidget.style.bottom = `${Math.round(targetBottom)}px`;
        schedulePrintButtonAnchorUpdate();
    }

    // 채팅 위젯 하단 오프셋 업데이트를 스케줄링하는 함수
    function scheduleChatWidgetBottomOffsetUpdate() {
        if (footerOffsetRafId !== null) {
            return;
        }
        footerOffsetRafId = window.requestAnimationFrame(updateChatWidgetBottomOffset);
        schedulePrintButtonAnchorUpdate();
    }

    // 채팅 위젯 모션을 따라가는 함수
    function followChatWidgetMotion(durationMs = widgetMotionFollowDurationMs) {
        // Keep anchor buttons visually attached while the widget animates between collapsed
        // and expanded states by continuing short-lived RAF updates during the transition.
        const now = (window.performance && typeof window.performance.now === 'function')
            ? window.performance.now()
            : Date.now();
        widgetMotionFollowUntil = Math.max(widgetMotionFollowUntil, now + durationMs);

        if (widgetMotionFollowRafId !== null) {
            return;
        }

        const step = function(timestamp) {
            scheduleChatWidgetBottomOffsetUpdate();

            if (timestamp < widgetMotionFollowUntil) {
                widgetMotionFollowRafId = window.requestAnimationFrame(step);
                return;
            }

            widgetMotionFollowRafId = null;
            scheduleChatWidgetBottomOffsetUpdate();
        };

        widgetMotionFollowRafId = window.requestAnimationFrame(step);
    }

    // 대화 기록을 로드하는 함수
    function loadConversationHistory() {
        // Storage contains only a sanitized transcript snapshot, not raw server payloads.
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter(item =>
                    item &&
                    (item.role === 'user' || item.role === 'assistant') &&
                    typeof item.content === 'string' &&
                    item.content.trim().length > 0
                )
                .slice(-CHAT_HISTORY_LIMIT);
        } catch (error) {
            console.warn('Failed to load chat history:', error);
            return [];
        }
    }

    // Persist only the trimmed in-memory conversation so reloads restore context without storing huge payloads.
    function saveConversationHistory() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationHistory.slice(-CHAT_HISTORY_LIMIT)));
        } catch (error) {
            console.warn('Failed to save chat history:', error);
        }
    }

    // Restore prior messages into both the UI and the request history array, or seed the default greeting.
    function restoreConversationHistory() {
        const saved = loadConversationHistory();
        if (saved.length > 0) {
            saved.forEach(item => {
                conversationHistory.push(item);
                addMessage(item.content, item.role === 'assistant' ? 'bot' : 'user', '', false);
            });
            return;
        }

        conversationHistory.push({ role: 'assistant', content: initialBotMessage });
        addMessage(initialBotMessage, 'bot', '', false);
        saveConversationHistory();
    }

    // The widget starts collapsed so it does not cover primary page content on first load.
    let isChatOpen = false;
    chatWidget.classList.remove('is-open');
    chatToggle.textContent = '+';

    // 채팅창 열림 상태를 설정하는 함수
    function setChatOpen(open) {
        // One place toggles open state so anchor positioning and transition-follow logic stay aligned.
        isChatOpen = open;
        chatWidget.classList.toggle('is-open', open);
        chatToggle.textContent = open ? '−' : '+';

        if (open) {
            // 애니메이션 프레임 이후 스크롤 보정
            window.requestAnimationFrame(scrollToBottom);
        }

        scheduleChatWidgetBottomOffsetUpdate();
        followChatWidgetMotion();
    }

    chatToggle.addEventListener('click', function() {
        setChatOpen(!isChatOpen);
    });

    const handleChatBodyTransitionEvent = function(event) {
        if (event.target !== chatBody) {
            return;
        }
        followChatWidgetMotion();
    };
    chatBody.addEventListener('transitionstart', handleChatBodyTransitionEvent);
    chatBody.addEventListener('transitionend', handleChatBodyTransitionEvent);
    chatBody.addEventListener('transitioncancel', handleChatBodyTransitionEvent);

    // UI-level send flow: append the user message immediately, then resolve the bot response asynchronously.
    async function sendMessage() {
        const message = userInput.value.trim();
        if (message === '') return;

        // 사용자 메시지 추가
        addMessage(message, 'user');
        
        // 입력 필드 초기화 및 비활성화
        userInput.value = '';
        userInput.disabled = true;
        
        try {
            // 챗봇 응답 생성 및 추가
            const botResponse = await getBotResponse(message);
            addMessage(botResponse, 'bot');
        } catch (error) {
            console.error('Error in sendMessage:', error);
            addMessage(i18n.responseProcessingError, 'bot');
        } finally {
            // 입력 필드 다시 활성화
            userInput.disabled = false;
            userInput.focus();
        }
    }

    // 컨테이너에 링크가 포함된 텍스트를 추가하는 함수
    function appendTextWithLinks(container, text) {
        // Preserve plain text semantics while still turning bare URLs into clickable links.
        const urlRegex = /(https?:\/\/[^\s<>()"'`\[\]{}|\\^]+(?:\([^\s<>()"'`\[\]{}|\\^]*\))*[^\s<>()"'`\[\]{}|\\^.,;:!?])/g;
        let lastIndex = 0;
        let match;

        while ((match = urlRegex.exec(text)) !== null) {
            const startIndex = match.index;
            const endIndex = startIndex + match[0].length;

            if (startIndex > lastIndex) {
                container.appendChild(document.createTextNode(text.slice(lastIndex, startIndex)));
            }

            const link = document.createElement('a');
            link.href = match[0];
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.className = 'chat-message-link';
            link.textContent = match[0];
            container.appendChild(link);

            lastIndex = endIndex;
        }

        if (lastIndex < text.length) {
            container.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
    }

    // Render one message bubble and optionally mirror it into the stored conversation history.
    function addMessage(text, sender, messageId = '', trackHistory = true) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        if (messageId) {
            messageDiv.id = messageId;
        }
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        const normalizedText = typeof text === 'string' ? text : String(text == null ? '' : text);
        const lines = normalizedText.split('\n');
        lines.forEach((line, index) => {
            appendTextWithLinks(contentDiv, line);
            if (index < lines.length - 1) {
                contentDiv.appendChild(document.createElement('br'));
            }
        });

        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        
        // 메시지가 추가된 후 스크롤을 아래로 이동
        scrollToBottom();

        if (trackHistory) {
            if (sender === 'user') {
                conversationHistory.push({ role: 'user', content: text });
            } else if (sender === 'bot') {
                conversationHistory.push({ role: 'assistant', content: text });
            }
            // Keep only recent history for request payload size.
            if (conversationHistory.length > CHAT_HISTORY_LIMIT) {
                conversationHistory.splice(0, conversationHistory.length - CHAT_HISTORY_LIMIT);
            }
            saveConversationHistory();
        }
        
        return messageDiv;
    }

    // Keep the newest message in view whenever content changes or the widget opens.
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Network request wrapper for chatbot replies, including CSRF checks and a small loading animation.
    async function getBotResponse(userMessage) {
        let loadingMessage = null;
        let loadingAnimationIntervalId = null;

        // 로딩 애니메이션을 시작하는 함수
        const startLoadingAnimation = function () {
            // Use a real message bubble for loading so the widget layout does not jump
            // when the final assistant reply replaces the placeholder.
            const loadingMessageId = 'loading-' + Date.now();
            loadingMessage = addMessage('.', 'bot', loadingMessageId, false);

            if (!loadingMessage) {
                return;
            }

            const loadingContent = loadingMessage.querySelector('.message-content');
            let dotCount = 1;

            loadingAnimationIntervalId = window.setInterval(function () {
                if (!loadingContent) {
                    return;
                }

                dotCount = (dotCount % 3) + 1;
                loadingContent.textContent = '.'.repeat(dotCount);
            }, LOADING_DOT_ANIMATION_INTERVAL_MS);
        };

        // 로딩 애니메이션을 중지하는 함수
        const stopLoadingAnimation = function () {
            // Always tear down the interval and placeholder bubble together so retries
            // never leave a stale loading indicator behind.
            if (loadingAnimationIntervalId !== null) {
                window.clearInterval(loadingAnimationIntervalId);
                loadingAnimationIntervalId = null;
            }

            if (loadingMessage) {
                loadingMessage.remove();
                loadingMessage = null;
            }
        };

        try {
            // 로딩 메시지 표시
            startLoadingAnimation();
            
            // CSRF 토큰 가져오기
            const csrfToken = getCSRFToken();
            if (!csrfToken) {
                console.error('CSRF token not found');
                return i18n.csrfMissingError;
            }

            // Send only a bounded slice of recent history so request payload size stays predictable.
            const response = await fetch(chatApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken
                },
                body: JSON.stringify({
                    message: userMessage,
                    history: conversationHistory.slice(-CHAT_REQUEST_HISTORY_LIMIT),
                    portfolio_owner_username: portfolioOwnerUsername
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('API Error:', response.status, errorData);
                throw new Error(selectServerMessage(errorData, `${i18n.apiRequestFailed}: ${response.status} ${response.statusText}`));
            }
            
            const data = await response.json();

            if (data.error) {
                console.error('Error from server:', data.error);
                return selectServerMessage(data, i18n.genericError);
            }
            
            return data.response || i18n.responseProcessingError;
            
        } catch (error) {
            console.error('Error calling GPT API:', error);
            return error && error.message ? error.message : i18n.serverCommunicationError;
        } finally {
            stopLoadingAnimation();
        }
    }
    
    // Prefer the meta tag token, then fall back to Django's csrftoken cookie for older pages.
    function getCSRFToken() {
        // 메타 태그에서 CSRF 토큰 가져오기
        const csrfTokenMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfTokenMeta) {
            return csrfTokenMeta.getAttribute('content');
        }
        
        // 메타 태그가 없을 경우 쿠키에서 가져오기 (백업)
        const name = 'csrftoken';
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    // 이벤트 리스너 등록
    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    window.addEventListener('scroll', scheduleChatWidgetBottomOffsetUpdate, { passive: true });
    window.addEventListener('resize', scheduleChatWidgetBottomOffsetUpdate, { passive: true });
    window.addEventListener('orientationchange', scheduleChatWidgetBottomOffsetUpdate, { passive: true });

    // 저장된 대화 복원
    restoreConversationHistory();

    scheduleChatWidgetBottomOffsetUpdate();
    schedulePrintButtonAnchorUpdate();

    // 채팅창이 닫힌 상태로 시작
});
