const GOOGLE_CLIENT_ID = '1016430465809-epuv90k71k4v76psln4ksaqbhfkpdmfb.apps.googleusercontent.com'; 
const LAMBDA_VERIFY_URL = 'https://bbohwj7ds0.execute-api.ap-northeast-2.amazonaws.com/default/auth/google';

// 중복 실행 방지 플래그
let isProcessing = false;

// 타임아웃 헬퍼 함수
function withTimeout(promise, timeoutMs, errorMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
}

// Google Sign-In 초기화
function initGoogleSignIn() {
  console.log('Initializing Google Sign-In...');
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleSignIn,
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: false  // FedCM 자동 프롬프트 비활성화
    });
    
    // 자동 프롬프트 완전히 비활성화
    google.accounts.id.disableAutoSelect();
    
    console.log('Google Sign-In initialized successfully');
  } catch (error) {
    console.error('Google Sign-In initialization failed:', error);
  }
}

// Google Sign-In 콜백 처리
async function handleGoogleSignIn(response) {
  // 중복 실행 방지
  if (isProcessing) {
    console.warn('⚠️ Sign-in already in progress, ignoring duplicate call');
    return;
  }
  
  isProcessing = true;
  console.log('🔐 Starting Google sign-in process...');
  
  try {
    const idToken = response.credential;
    
    console.log('Sending ID token to Lambda...');
    
    // Lambda 중개서버로 ID 토큰 전송
    const lambdaResponse = await fetch(LAMBDA_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id_token: idToken })
    });

    console.log('Lambda response status:', lambdaResponse.status);
    
    if (!lambdaResponse.ok) {
      const errorData = await lambdaResponse.json().catch(() => ({}));
      console.error('Lambda error:', errorData);
      throw new Error(errorData.error || 'Failed to verify Google sign-in');
    }

    const userData = await lambdaResponse.json();
    console.log('Google sign-in successful:', userData);
    
    // 기존 사용자 확인 및 자동 가입 처리
    const { addData, getAllData, updateData } = await import('../database.js');
    const existingUsers = await getAllData('mydata');
    let user = existingUsers.find(u => u.myId === userData.email);
    let isNewUser = false;
    const fileName = `user_${userData.email.replace('@', '_at_')}.json`;
    
    // Google Drive 동기화 (신규/기존 모두 처리)
    // Google Drive API 사용은 선택적 - 실패해도 로컬 데이터로 진행
    try {
      if (!user) {
        // 새 사용자 자동 생성
        console.log('🆕 New user detected. Creating account automatically...');
        isNewUser = true;
        
        const newUser = {
          myId: userData.email,
          nick: userData.name || userData.email.split('@')[0],
          company: '',
          secretKey: '',
          mystaff: [],
          credentials: {},
          googleUser: userData,
          createdAt: new Date().toISOString()
        };

        // 먼저 로컬에 저장
        await addData('mydata', newUser);
        user = newUser;
        console.log('✅ New account created locally');
        console.log('ℹ️ Use the Sync button in settings to backup to Google Drive.');
      } else {
        // 기존 사용자 - 로컬 데이터 사용
        console.log('👤 Existing user detected. Using local data.');
        console.log('ℹ️ Use the Sync button in settings to sync with Google Drive.');
        // user는 이미 로컬 DB에서 로드됨
      }
    } catch (error) {
      console.error('❌ Critical error during user setup:', error);
      
      if (isNewUser) {
        // 신규 사용자는 최소한 로컬에 저장
        const newUser = {
          myId: userData.email,
          nick: userData.name || userData.email.split('@')[0],
          company: '',
          secretKey: '',
          mystaff: [],
          credentials: {},
          googleUser: userData,
          createdAt: new Date().toISOString()
        };
        await addData('mydata', newUser);
        user = newUser;
      }
      // 기존 사용자는 이미 로컬에 있으므로 그대로 사용
    }
    
    // 로그인 성공 처리 - 로그인 여부와 사용자 ID만 저장
    localStorage.setItem('mystaff_loggedin', 'true');
    localStorage.setItem('mystaff_user', userData.email);
    
    // Google 프롬프트 취소 (One Tap 등)
    try {
      google.accounts.id.cancel();
    } catch (e) {
      console.log('No active Google prompt to cancel');
    }
    
    // 신규 사용자 여부에 따라 다른 메시지
    if (isNewUser) {
      console.log('✅ New user sign-in completed');
      alert(`Welcome ${userData.name}! Your account has been created.\n\nUse the Sync button in Settings to backup your data to Google Drive.`);
    } else {
      console.log('✅ Existing user sign-in completed');
      alert(`Welcome back, ${userData.name}!\n\nUse the Sync button in Settings to sync with Google Drive.`);
    }
    
    // 페이지 이동 전 플래그 초기화
    isProcessing = false;
    console.log('🏠 Redirecting to mystaff page...');
    
    // 약간의 지연 후 리디렉션 (Google 프롬프트가 완전히 닫힐 시간을 줌)
    setTimeout(() => {
      window.location.href = './mystaff.html';
    }, 100);
    
  } catch (error) {
    console.error('❌ Google sign-in error:', error);
    alert(`Google sign-in failed: ${error.message}. Please check the console for details.`);
    isProcessing = false; // 에러 발생 시 플래그 초기화
  }
}

// Google Sign-In SDK 로드 확인 플래그
let isSDKInitialized = false;

$(function() {
  const $googleSignInBtn = $('#googleSignIn');

  // 현재 URL 확인
  console.log('Current page URL:', window.location.href);
  console.log('Current origin:', window.location.origin);
  
  // 페이지 로드 시 이전 세션 정리
  console.log('Cleaning up any previous Google session...');
  
  // Google Sign-In SDK 로드 대기
  function waitForGoogleSDK() {
    if (typeof google !== 'undefined' && google.accounts) {
      // 이미 초기화된 경우 중복 실행 방지
      if (isSDKInitialized) {
        console.log('Google SDK already initialized, skipping duplicate initialization');
        return;
      }
      
      isSDKInitialized = true;
      console.log('Google SDK loaded successfully');
      
      // 먼저 자동 선택 비활성화
      google.accounts.id.disableAutoSelect();
      
      // 활성 프롬프트 취소
      try {
        google.accounts.id.cancel();
      } catch (e) {
        console.log('No active prompt to cancel');
      }
      
      // 초기화
      initGoogleSignIn();
      
      // Google 버튼을 한 번만 렌더링
      if ($googleSignInBtn.length) {
        const originalContent = $googleSignInBtn.html();
        $googleSignInBtn.html('');
        
        try {
          google.accounts.id.renderButton(
            document.getElementById('googleSignIn'),
            { 
              theme: 'filled_blue', 
              size: 'large',
              width: 280,
              text: 'signin_with',
              shape: 'rectangular',
              logo_alignment: 'left'
            }
          );
          console.log('Google button rendered successfully');
        } catch (error) {
          console.error('Failed to render Google button:', error);
          $googleSignInBtn.html(originalContent);
        }
      }
    } else {
      console.log('Waiting for Google SDK...');
      setTimeout(waitForGoogleSDK, 100);
    }
  }

  waitForGoogleSDK();
});
