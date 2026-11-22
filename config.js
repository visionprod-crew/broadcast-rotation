// ─────────────────────────────────────────────────────────────
//  방송팀 로테이션 — 설정 파일
//  firebase 값을 비워두면 "로컬 모드"(이 기기 브라우저에만 저장)로 동작합니다.
//  팀장·부팀장이 각자 폰에서 같은 데이터를 보려면 README의 Firebase 연결 방법대로
//  아래 firebase 항목을 채워주세요.
// ─────────────────────────────────────────────────────────────
window.APP_CONFIG = {
  // 메인 관리자 아이디 (Firebase 모드에서 이 아이디만 관리자 권한을 가짐)
  ownerId: 'admin',

  // 로그인 아이디를 내부 이메일로 바꿀 때 쓰는 도메인 (실제 메일은 발송되지 않음)
  loginDomain: 'vfc-rotation.app',

  // Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) 에서 복사한 값으로 교체
  firebase: null,
  /* 예시
  firebase: {
    apiKey: "AIza...",
    authDomain: "my-project.firebaseapp.com",
    projectId: "my-project",
    storageBucket: "my-project.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef"
  },
  */
};
