/**
 * toast_utils.js — 공용 토스트 알림 유틸
 *
 * 페이지에 토스트 엘리먼트가 없으면 자동으로 주입한 뒤
 * 짧은 메시지를 잠시 표시하고 사라집니다.
 */

const TOAST_ID = 'global-toast';

function ensureToastElement() {
    let el = document.getElementById(TOAST_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = TOAST_ID;
    el.style.cssText = [
        'position: fixed',
        'left: 50%',
        'bottom: 32px',
        'transform: translateX(-50%) translateY(20px)',
        'display: none',
        'align-items: center',
        'gap: 8px',
        'padding: 12px 20px',
        'background: rgba(15, 23, 42, 0.92)',
        'color: #ffffff',
        'border-radius: 999px',
        'font-size: 14px',
        'font-weight: 500',
        'box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18)',
        'z-index: 9999',
        'pointer-events: none',
        'opacity: 0',
        'transition: opacity 0.2s ease, transform 0.2s ease',
        "font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif"
    ].join(';');

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined toast-icon';
    icon.style.cssText = "font-size: 20px; font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20;";
    icon.textContent = 'check_circle';

    const text = document.createElement('span');
    text.className = 'toast-text';

    el.appendChild(icon);
    el.appendChild(text);
    document.body.appendChild(el);
    return el;
}

let hideTimer = null;
let fadeTimer = null;

/**
 * 토스트 메시지를 잠시 표시합니다.
 *
 * @param {string} message - 표시할 메시지
 * @param {object} [options]
 * @param {string} [options.icon='check_circle'] - Material Symbols 아이콘 이름
 * @param {string} [options.iconColor] - 아이콘 색상 (기본: 흰색)
 * @param {number} [options.duration=2000] - 표시 시간(ms)
 */
export function showToast(message, options = {}) {
    const { icon = 'check_circle', iconColor, duration = 2000 } = options;
    const el = ensureToastElement();

    const iconEl = el.querySelector('.toast-icon');
    const textEl = el.querySelector('.toast-text');

    if (iconEl) {
        iconEl.textContent = icon;
        iconEl.style.color = iconColor || '#ffffff';
    }
    if (textEl) textEl.textContent = message;

    if (hideTimer) clearTimeout(hideTimer);
    if (fadeTimer) clearTimeout(fadeTimer);

    el.style.display = 'flex';
    // 다음 프레임에 트랜지션 트리거
    requestAnimationFrame(() => {
        el.style.opacity = '1';
        el.style.transform = 'translateX(-50%) translateY(0)';
    });

    hideTimer = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(20px)';
        fadeTimer = setTimeout(() => {
            el.style.display = 'none';
        }, 220);
    }, duration);
}
