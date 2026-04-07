/**
 * Jest 전역 설정 — 모든 테스트 파일 실행 전에 로드됨
 * 브라우저 전역 변수(window.config 등)를 Node/jsdom 환경에서 흉내냄
 */

// window.config — front-config.js가 브라우저에서 설정하는 전역 설정 객체
global.window = global.window || {};

window.config = {
  supabase: {
    url: 'https://test-project.supabase.co',
    anonKey: 'test-anon-key-1234567890',
    uploadHandlerUrl: 'https://test-project.supabase.co/functions/v1/upload-handler',
    aiHandlerUrl: 'https://test-project.supabase.co/functions/v1/ai-handler'
  }
};

// jQuery stub — $ 사용 코드가 import 시 에러 내지 않도록
global.$ = global.jQuery = function () {
  return {
    ready: (fn) => fn(),
    on: () => global.$(),
    off: () => global.$(),
    hide: () => global.$(),
    show: () => global.$(),
    text: () => global.$(),
    val: () => '',
    html: () => global.$(),
    addClass: () => global.$(),
    removeClass: () => global.$(),
    find: () => global.$(),
    each: () => global.$(),
    trigger: () => global.$(),
    prop: () => global.$(),
    attr: () => global.$(),
    css: () => global.$(),
    click: () => global.$(),
    append: () => global.$(),
    empty: () => global.$(),
    modal: () => global.$(),
    closest: () => global.$(),
    parent: () => global.$()
  };
};

// fetch 기본 mock — 각 테스트에서 필요 시 재정의
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  text: async () => '',
  json: async () => ({})
});

// alert / confirm stub
global.alert = jest.fn();
global.confirm = jest.fn(() => true);
