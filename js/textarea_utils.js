export function autoResizeTextarea($el) {
    if (!$el.length) return;
    $el.css('height', 'auto');
    $el.css('height', $el[0].scrollHeight + 'px');
}
