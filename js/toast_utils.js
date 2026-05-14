/**
 * toast_utils.js — 공용 토스트 알림 + 패널 오버레이 유틸
 *
 * - showToast(): 짧은 알림 메시지를 비차단 방식으로 노출
 * - showPanelOverlay(target, options): 특정 패널 위에 블러+스피너 오버레이를 띄움
 *   여러 파일 업로드처럼 "이 영역은 지금 처리 중" 임을 컨텍스트로 보여줄 때 사용
 */

const TOAST_ID = 'global-toast';
const OVERLAY_STYLE_ID = 'dealchat-panel-overlay-style';

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

// ============================================================================
// 패널 오버레이 — 특정 영역 위에 블러+스피너를 띄워 "이 영역 처리 중" 표시
// ============================================================================

function ensureOverlayStyle() {
    if (document.getElementById(OVERLAY_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = OVERLAY_STYLE_ID;
    style.textContent = `
@keyframes dealchat-panel-overlay-spin { to { transform: rotate(360deg); } }
.dc-panel-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(15, 23, 42, 0.18);
    backdrop-filter: blur(2.5px);
    -webkit-backdrop-filter: blur(2.5px);
    border-radius: inherit;
    z-index: 50;
    opacity: 0;
    transition: opacity 0.18s ease;
    font-family: 'Pretendard', 'Apple SD Gothic Neo', sans-serif;
}
.dc-panel-overlay.is-visible { opacity: 1; }
.dc-panel-overlay-spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.55);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: dealchat-panel-overlay-spin 0.75s linear infinite;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.12);
}
.dc-panel-overlay-label {
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: -0.01em;
    text-shadow: 0 1px 4px rgba(15, 23, 42, 0.35);
}
`;
    document.head.appendChild(style);
}

/**
 * 대상 엘리먼트 위에 블러 + 스피너 오버레이를 띄웁니다.
 * 반환된 핸들의 update/hide 로 라벨 변경·해제할 수 있습니다.
 *
 * @param {Element|JQuery} target - 오버레이를 입힐 패널 (보통 .data-section)
 * @param {object} [options]
 * @param {string} [options.label='처리 중...'] - 스피너 아래 표시할 라벨
 * @returns {{ update(label: string): void, hide(opts?: {toast?: string, status?: 'success'|'error'|'info'}): void }}
 */
export function showPanelOverlay(target, options = {}) {
    const el = (target && target.jquery) ? target[0] : target;
    if (!el) return { update() {}, hide() {} };

    ensureOverlayStyle();

    // 자식 absolute를 받을 수 있도록 position 보정
    const computed = window.getComputedStyle(el);
    const prevPosition = el.style.position;
    const needsRelative = computed.position === 'static';
    if (needsRelative) el.style.position = 'relative';

    const overlay = document.createElement('div');
    overlay.className = 'dc-panel-overlay';

    const spinner = document.createElement('div');
    spinner.className = 'dc-panel-overlay-spinner';

    const label = document.createElement('div');
    label.className = 'dc-panel-overlay-label';
    label.textContent = options.label || '처리 중...';

    overlay.appendChild(spinner);
    overlay.appendChild(label);
    el.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('is-visible'));

    let removed = false;
    return {
        update(newLabel) {
            if (!removed && typeof newLabel === 'string') label.textContent = newLabel;
        },
        hide(opts = {}) {
            if (removed) return;
            removed = true;
            overlay.classList.remove('is-visible');
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                if (needsRelative) el.style.position = prevPosition;
            }, 200);

            if (opts.toast) {
                const status = opts.status || 'success';
                if (status === 'error') {
                    showToast(opts.toast, { icon: 'error', iconColor: '#ef4444', duration: 4500 });
                } else if (status === 'info') {
                    showToast(opts.toast, { icon: 'info', iconColor: '#6366f1', duration: 2500 });
                } else {
                    showToast(opts.toast, { icon: 'check_circle', iconColor: '#22c55e' });
                }
            }
        }
    };
}
