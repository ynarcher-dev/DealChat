/**
 * APIcallFunction.js 테스트
 *
 * 목적: 리팩토링 전 현재 라우팅 동작을 기록한다.
 *   - upload  → uploadHandlerUrl (POST)
 *   - search_vector / body 포함 → aiHandlerUrl (POST)
 *   - CRUD (create/read/update/delete) → Supabase REST API
 *   - 에러 응답 → [DB Error] 메시지로 throw
 */
import { APIcall } from '../js/APIcallFunction.js';

const BASE_URL = 'https://test-project.supabase.co';
const UPLOAD_URL = `${BASE_URL}/functions/v1/upload-handler`;
const AI_URL = `${BASE_URL}/functions/v1/ai-handler`;
const ANON_KEY = 'test-anon-key-1234567890';

function lastFetchCall() {
  const calls = global.fetch.mock.calls;
  const [endpoint, opts] = calls[calls.length - 1];
  return { endpoint, opts, body: opts.body ? JSON.parse(opts.body) : undefined };
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
  localStorage.clear();
});

// ─── 업로드 라우팅 ────────────────────────────────────────────────────────────

describe('upload 액션', () => {
  test('uploadHandlerUrl로 POST 요청', async () => {
    await APIcall({ action: 'upload', fileData: 'base64...' }, null, {});
    const { endpoint, opts } = lastFetchCall();
    expect(endpoint).toBe(UPLOAD_URL);
    expect(opts.method).toBe('POST');
  });

  test('Content-Type: application/json 헤더 포함', async () => {
    await APIcall({ action: 'upload' }, null, {});
    const { opts } = lastFetchCall();
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('body에 원본 prompts 포함', async () => {
    await APIcall({ action: 'upload', name: 'test.pdf' }, null, {});
    const { body } = lastFetchCall();
    expect(body.action).toBe('upload');
    expect(body.name).toBe('test.pdf');
  });
});

// ─── AI / Vector Search 라우팅 ───────────────────────────────────────────────

describe('search_vector 액션', () => {
  test('aiHandlerUrl로 POST 요청', async () => {
    await APIcall({ action: 'search_vector', query: '검색어' }, null, {});
    const { endpoint } = lastFetchCall();
    expect(endpoint).toBe(AI_URL);
  });
});

describe('body 필드 포함 요청 (AI 요청)', () => {
  test('aiHandlerUrl로 라우팅', async () => {
    await APIcall({ body: '프롬프트 내용' }, null, {});
    const { endpoint } = lastFetchCall();
    expect(endpoint).toBe(AI_URL);
  });
});

// ─── CRUD 라우팅 ─────────────────────────────────────────────────────────────

describe('CRUD create', () => {
  test('테이블 REST 엔드포인트로 POST', async () => {
    await APIcall({ table: 'companies', action: 'create', name: '테스트 회사' }, null, {});
    const { endpoint, opts, body } = lastFetchCall();
    expect(endpoint).toBe(`${BASE_URL}/rest/v1/companies`);
    expect(opts.method).toBe('POST');
    expect(opts.headers['Prefer']).toBe('return=representation');
  });

  test('body에서 table·action 제거, 데이터만 전송', async () => {
    await APIcall({ table: 'companies', action: 'create', name: '테스트 회사' }, null, {});
    const { body } = lastFetchCall();
    expect(body.table).toBeUndefined();
    expect(body.action).toBeUndefined();
    expect(body.name).toBe('테스트 회사');
  });
});

describe('CRUD read', () => {
  test('GET 요청, 쿼리 파라미터로 필터', async () => {
    await APIcall({ table: 'companies', action: 'read', id: '123' }, null, {});
    const { endpoint, opts } = lastFetchCall();
    expect(opts.method).toBe('GET');
    expect(endpoint).toContain('/rest/v1/companies');
    expect(endpoint).toContain('id=eq.123');
    expect(endpoint).toContain('select=*');
  });

  test('body 없음 (GET은 body 미전송)', async () => {
    await APIcall({ table: 'companies', action: 'read' }, null, {});
    const { opts } = lastFetchCall();
    expect(opts.body).toBeUndefined();
  });

  test('is.null 값은 그대로 전달', async () => {
    await APIcall({ table: 'companies', action: 'read', deleted_at: 'is.null' }, null, {});
    const { endpoint } = lastFetchCall();
    expect(endpoint).toContain('deleted_at=is.null');
  });

  test('빈 문자열 필드는 쿼리 파라미터 제외', async () => {
    await APIcall({ table: 'companies', action: 'read', name: '' }, null, {});
    const { endpoint } = lastFetchCall();
    expect(endpoint).not.toContain('name=');
  });
});

describe('CRUD update', () => {
  test('id 필터 포함 PATCH 요청', async () => {
    await APIcall({ table: 'companies', action: 'update', id: '456', name: '수정된 이름' }, null, {});
    const { endpoint, opts } = lastFetchCall();
    expect(opts.method).toBe('PATCH');
    expect(endpoint).toContain('id=eq.456');
    expect(opts.headers['Prefer']).toBe('return=representation');
  });
});

describe('CRUD delete', () => {
  test('id 필터 포함 DELETE 요청', async () => {
    await APIcall({ table: 'companies', action: 'delete', id: '789' }, null, {});
    const { endpoint, opts } = lastFetchCall();
    expect(opts.method).toBe('DELETE');
    expect(endpoint).toContain('id=eq.789');
  });

  test('fileId도 delete 필터로 사용 가능', async () => {
    await APIcall({ table: 'files', action: 'delete', fileId: 'f-001' }, null, {});
    const { endpoint } = lastFetchCall();
    expect(endpoint).toContain('id=eq.f-001');
  });
});

// ─── 헤더 ────────────────────────────────────────────────────────────────────

describe('인증 헤더', () => {
  test('기본: anonKey로 Bearer 헤더 설정', async () => {
    await APIcall({ action: 'upload' }, null, {});
    const { opts } = lastFetchCall();
    expect(opts.headers['apikey']).toBe(ANON_KEY);
    expect(opts.headers['Authorization']).toBe(`Bearer ${ANON_KEY}`);
  });

  test('localStorage에 세션 토큰이 있으면 해당 토큰 사용', async () => {
    const projectId = BASE_URL.split('://')[1].split('.')[0]; // 'test-project'
    localStorage.setItem(
      `sb-${projectId}-auth-token`,
      JSON.stringify({ access_token: 'user-access-token-xyz' })
    );
    await APIcall({ action: 'upload' }, null, {});
    const { opts } = lastFetchCall();
    expect(opts.headers['Authorization']).toBe('Bearer user-access-token-xyz');
  });
});

// ─── 에러 처리 ────────────────────────────────────────────────────────────────

describe('에러 응답 처리', () => {
  test('ok=false → [DB Error] 메시지로 throw', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ message: '레코드를 찾을 수 없습니다' })
    });
    await expect(APIcall({ action: 'upload' }, null, {}))
      .rejects.toThrow('[DB Error] 레코드를 찾을 수 없습니다');
  });

  test('JSON 파싱 불가 에러는 원문 텍스트로 throw', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => 'Internal Server Error'
    });
    await expect(APIcall({ action: 'upload' }, null, {}))
      .rejects.toThrow('[DB Error] Internal Server Error');
  });
});
