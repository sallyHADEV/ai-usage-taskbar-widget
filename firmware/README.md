# GeekMagic SmallTV용 AI Quota 커스텀 펌웨어

GeekMagic SmallTV (ESP8266) 디스플레이에서 AI 사용량(Quota)을 실시간으로 모니터링할 수 있도록 수정한 커스텀 펌웨어 바이너리입니다.

본 위젯의 **설정 > API** 탭에서 엔드포인트 URL을 지정하면, 쿼터 새로고침 시 SmallTV로 사용량 데이터가 자동 푸시(HTTP POST)되어 화면에 표시됩니다.

---

## 기반 프로젝트 및 출처
- 베이스 프로젝트: [giovi321/smalltv-mod](https://github.com/giovi321/smalltv-mod)
- 펌웨어 바이너리: [`firmware-custom-ai-quota.bin`](./firmware-custom-ai-quota.bin)

---

## 펌웨어 설치 및 플래싱 주의사항

> [!IMPORTANT]
> **반드시 원본 저장소의 로더 펌웨어를 통해 업로드해야 합니다.**

1. [giovi321/smalltv-mod](https://github.com/giovi321/smalltv-mod) 저장소 안내에 따라 먼저 **로더 펌웨어(`loader`)**를 기기에 플래싱합니다.
2. 기기의 로더 웹 인터페이스 또는 OTA 업로더를 통해 본 저장소의 `firmware-custom-ai-quota.bin` 파일을 선택하여 업로드합니다.
3. 기기 부팅 후 Wi-Fi 및 네트워크 설정을 완료합니다.

---

## AI Usage Widget 연동 설정

1. 작업표시줄 위젯 또는 트레이 아이콘을 통해 **설정** 창을 엽니다.
2. **API** 탭으로 이동합니다.
3. **API Push 활성화** 토글을 켭니다.
4. **Endpoint URL**에 SmallTV의 수신 주소를 입력합니다:
   ```text
   http://<SmallTV의-IP-주소>:8080/api/usage
   ```
5. 화면 번호(Screen)를 지정하고 설정을 저장합니다.
6. 이후 위젯이 쿼터를 갱신할 때마다 SmallTV로 사용량 데이터가 자동 전송됩니다.
