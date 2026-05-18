/**
 * ai_skeleton_utils.js
 * AI 자동 입력 동안 타깃 필드에 시머 스켈레톤을 깔고, 채워진 직후
 * 짧은 하이라이트로 완료를 시각적으로 알리는 유틸.
 *
 * 사용 예:
 *   import { applyAiSkeleton, finishAiSkeleton } from './ai_skeleton_utils.js';
 *
 *   const fields = ['#name', '#summary', '#manager-memo'];
 *   const containers = ['#financial-table-container'];
 *   applyAiSkeleton({ fields, containers });
 *   try { ... await aiCall(); ... }
 *   finally { finishAiSkeleton({ fields, containers }); }
 */

const SKELETON_CLASS = 'ai-skeleton';
const CONTAINER_SKELETON_CLASS = 'ai-container-skeleton';
const HIGHLIGHT_CLASS = 'ai-highlight';
const HIGHLIGHT_DURATION_MS = 1700;

function $$(sel) {
    if (!sel) return $();
    return sel.jquery ? sel : $(sel);
}

/**
 * 필드/컨테이너에 스켈레톤을 적용한다.
 * @param {{fields?: string[], containers?: string[]}} opts
 */
export function applyAiSkeleton({ fields = [], containers = [] } = {}) {
    fields.forEach(sel => $$(sel).addClass(SKELETON_CLASS));
    containers.forEach(sel => $$(sel).addClass(CONTAINER_SKELETON_CLASS));
}

/**
 * 스켈레톤을 제거하고, 값이 채워져 있는 필드만 짧게 하이라이트.
 * @param {{fields?: string[], containers?: string[], highlightAllContainers?: boolean}} opts
 *   highlightAllContainers: true면 컨테이너는 비어있어도 하이라이트(기본 false)
 */
export function finishAiSkeleton({ fields = [], containers = [], highlightAllContainers = false } = {}) {
    fields.forEach(sel => {
        const $el = $$(sel);
        if (!$el.length) return;
        $el.removeClass(SKELETON_CLASS);
        if (!isEffectivelyEmpty($el)) pulse($el);
    });
    containers.forEach(sel => {
        const $el = $$(sel);
        if (!$el.length) return;
        $el.removeClass(CONTAINER_SKELETON_CLASS);
        if (highlightAllContainers || $el.children().length > 0) pulse($el);
    });
}

/**
 * 에러 등으로 도중에 중단해야 할 때: 스켈레톤만 즉시 제거 (하이라이트 X).
 */
export function clearAiSkeleton({ fields = [], containers = [] } = {}) {
    fields.forEach(sel => $$(sel).removeClass(SKELETON_CLASS));
    containers.forEach(sel => $$(sel).removeClass(CONTAINER_SKELETON_CLASS));
}

function pulse($el) {
    $el.removeClass(HIGHLIGHT_CLASS);
    // reflow trigger — 같은 클래스 재적용 시 애니메이션 재시작
    if ($el[0]) void $el[0].offsetWidth;
    $el.addClass(HIGHLIGHT_CLASS);
    setTimeout(() => $el.removeClass(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION_MS);
}

function isEffectivelyEmpty($el) {
    if ($el.is('input, textarea')) return !($el.val() || '').toString().trim();
    if ($el.is('select')) {
        const v = $el.val();
        return v == null || v === '' || v === 'undefined';
    }
    // contenteditable / 일반 요소
    return !$el.text().trim();
}

/**
 * AI 자동입력 전 과정 UX 래퍼.
 *  - 시작: 필드/컨테이너 스켈레톤 + 버튼을 "분석 중... N초" 카운터로 전환
 *  - end(): 스켈레톤 제거 + 채워진 항목 펄스 + 버튼 원복
 *
 * 사용:
 *   const ux = beginAiAutofillUx({
 *       $btn: $('#ai-auto-fill-btn'),
 *       fields: ['#summary', '#ceo-name'],
 *       containers: ['#financial-table-container'],
 *   });
 *   try { ... await aiCall(); ... } finally { ux.end(); }
 */
export function beginAiAutofillUx({ $btn, fields = [], containers = [] } = {}) {
    applyAiSkeleton({ fields, containers });

    const startTime = Date.now();
    const originalHtml = $btn && $btn.length ? $btn.html() : null;

    const renderBtn = (sec) => {
        if (!$btn || !$btn.length) return;
        $btn.html(
            '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" ' +
            'style="margin-right: 8px; color: #ffffff;"></span>' +
            '<span style="font-size: 14px; font-weight: 600; color: #ffffff;">' +
            '분석 중... ' + sec + '초</span>'
        );
    };

    if ($btn && $btn.length) {
        $btn.prop('disabled', true).addClass('analyzing');
        renderBtn(0);
    }

    const timerId = setInterval(() => {
        const sec = Math.floor((Date.now() - startTime) / 1000);
        renderBtn(sec);
    }, 1000);

    let ended = false;
    return {
        end(success = true) {
            if (ended) return;
            ended = true;
            clearInterval(timerId);
            if (success) finishAiSkeleton({ fields, containers });
            else clearAiSkeleton({ fields, containers });
            if ($btn && $btn.length) {
                $btn.prop('disabled', false).removeClass('analyzing');
                if (originalHtml !== null) $btn.html(originalHtml);
            }
        }
    };
}
