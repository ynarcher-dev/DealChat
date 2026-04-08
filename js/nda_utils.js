/**
 * 로컬 스토리지에서 체결된 NDA 목록을 가져옵니다.
 * @param {string} entityType - 'seller' 또는 'buyer'
 * @param {string} userId - 사용자 ID
 */
export function getSignedNdas(entityType, userId) {
    try {
        const uid = userId || 'anonymous';
        const key = `dealchat_signed_ndas_${entityType}s_${uid}`;
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error('getSignedNdas error:', e);
        return [];
    }
}

/**
 * 로컬 스토리지에 NDA 체결 정보를 저장합니다.
 * @param {string} entityType - 'seller' 또는 'buyer'
 * @param {string} entityId - 대상 ID (seller_id 또는 buyer_id)
 * @param {string} userId - 사용자 ID
 */
export function saveSignedNda(entityType, entityId, userId) {
    try {
        const signed = getSignedNdas(entityType, userId);
        const strId = String(entityId);
        if (!signed.includes(strId)) {
            signed.push(strId);
            const uid = userId || 'anonymous';
            const key = `dealchat_signed_ndas_${entityType}s_${uid}`;
            localStorage.setItem(key, JSON.stringify(signed));
        }
    } catch (e) {
        console.error('saveSignedNda error:', e);
    }
}
