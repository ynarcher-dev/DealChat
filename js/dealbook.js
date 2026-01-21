$(document).ready(function () {
    const $chatInput = $('#chat-input');
    const $chatMessages = $('#chat-messages');
    const $welcomeScreen = $('.welcome-screen');
    const $guidePanel = $('#guide-panel');

    // Auto-resize textarea
    $chatInput.on('input', function () {
        $(this).css('height', 'auto');
        $(this).css('height', this.scrollHeight + 'px');
    });

    // Send message function
    function sendMessage() {
        const text = $chatInput.val().trim();
        if (text) {
            if ($welcomeScreen.length) {
                $welcomeScreen.hide();
            }

            // User Message
            addMessage(text, 'user');
            $chatInput.val('').css('height', 'auto');

            // Simulate AI response
            setTimeout(() => {
                addAiResponse(text);
            }, 800);
        }
    }

    function addMessage(text, sender) {
        const avatar = sender === 'ai'
            ? '<div class="avatar material-symbols-outlined">auto_awesome</div>'
            : '<img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="User" class="avatar">';

        const messageHtml = `
            <div class="message ${sender}">
                ${sender === 'ai' ? avatar : ''}
                <div class="message-content">${text}</div>
                ${sender === 'user' ? avatar : ''}
            </div>
        `;

        const $message = $(messageHtml);
        $chatMessages.append($message);

        // Scroll to bottom
        $chatMessages.animate({ scrollTop: $chatMessages[0].scrollHeight }, 300);
    }

    function addAiResponse(userInput) {
        let response = "";
        if (userInput.includes("요약")) {
            response = "업로드된 소스들을 바탕으로 한 요약입니다:<br>1. 2024 신규 사업 전략은 AI 기술 도입을 최우선 과제로 선정했습니다.<br>2. 주요 타겟 시장은 동남아시아 3개국입니다.<br>3. 예산은 전년 대비 15% 증액되었습니다.";
        } else if (userInput.includes("시장")) {
            response = "시장 분석 결과, 현재 생성형 AI 솔루션에 대한 수요가 급증하고 있습니다. 특히 리서치 보조 도구 분야에서 연평균 30% 성장이 기대됩니다.";
        } else {
            response = `'${userInput}'에 대해 소스를 분석한 결과, 관련 내용은 프로젝트 개요 PDF의 4페이지와 시장 조사 보고서의 12페이지에서 언급되고 있습니다. 추가로 구체적인 내용이 필요하신가요?`;
        }

        addMessage(response, 'ai');
    }

    // Event Listeners
    $('#send-btn').on('click', sendMessage);

    $chatInput.on('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Guide Panel Toggle
    $('.btn-primary').on('click', function () {
        $guidePanel.toggleClass('hidden');
    });

    $('#close-guide').on('click', function () {
        $guidePanel.addClass('hidden');
    });

    // Prompt Chips
    $('.prompt-chip').on('click', function () {
        const promptText = $(this).text();
        $chatInput.val(promptText);
        sendMessage();
    });

    // Add Source logic
    const $fileUpload = $('#file-upload');
    const $sourceList = $('#source-list');

    $('#add-source').on('click', function () {
        $fileUpload.click();
    });

    $fileUpload.on('change', function (e) {
        const files = e.target.files;
        if (files.length > 0) {
            if ($welcomeScreen.length) {
                $welcomeScreen.hide();
            }

            Array.from(files).forEach(file => {
                const icon = getFileIcon(file.name);
                const $newItem = $(`
                    <li class="source-item">
                        <span class="material-symbols-outlined">${icon}</span>
                        <span class="source-name">${file.name}</span>
                    </li>
                `);

                $newItem.on('click', function () {
                    $('.source-item').removeClass('active');
                    $(this).addClass('active');
                });

                $sourceList.append($newItem);
            });

            addMessage(`${files.length}개의 소스가 추가되었습니다.`, 'ai');

            // Reset input so the same file can be uploaded again if needed
            $fileUpload.val('');
        }
    });

    function getFileIcon(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        switch (ext) {
            case 'pdf': return 'description';
            case 'doc':
            case 'docx': return 'article';
            case 'txt': return 'text_fields';
            default: return 'attachment';
        }
    }
});
