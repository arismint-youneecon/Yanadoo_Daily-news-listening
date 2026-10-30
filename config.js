// 클럽 설정. Supabase 주소와 공개용 키(publishable 또는 anon)를 넣으면 실제 모드로 동작합니다.
// 비워 두면 브라우저 안에서만 도는 데모 모드가 됩니다 (데모 관리자 코드: DEMO2026).
window.CLUB_CONFIG = {
  clubName: "아침 영어 뉴스 클럽",
  supabaseUrl: "https://idceljjzibugxpgnxtxv.supabase.co",
  supabaseAnonKey: "sb_publishable_u-4Q1vaO0gO1Kroek0Wt7w_2mcP5s_U",
  // 앱 알림용 공개 키(VAPID public key). 짝이 되는 개인 키는 Supabase에만 있습니다.
  vapidPublicKey: "BLUzBwF7UXBuK58SbDULjscahhStns8Qr3nOMV8D2az2gV2sWvGk7NVyYi0DjPzTUaloTNO8d7NL-nvC-gKMY28"
};
