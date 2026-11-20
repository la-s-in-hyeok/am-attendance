# 문서 변환용 글꼴

한글(HWP·HWPX)·워드(DOCX) 파일을 PDF로 바꿀 때, 문서에 쓰인 한컴·MS 글꼴(함초롬바탕, 맑은 고딕, 굴림 등)
대신 쓰는 무료 글꼴이에요. `src/lib/convert/fonts.ts` 가 이 파일들을 한컴·MS 글꼴 이름으로 등록해서,
어느 휴대폰에서 바꿔도 결과가 같게 나와요. 앱 화면 글꼴과는 상관없어요.

| 파일 | 글꼴 | 크기 | SHA-256 |
| --- | --- | --- | --- |
| NotoSerifKR-Regular.woff2 | Noto Serif KR 400 (명조·바탕 계열 대신) | 949KB | `c9a1e3ac69994d680883b53b1fd83d520733b704792522a932bfaa276117de45` |
| NotoSerifKR-Bold.woff2 | Noto Serif KR 700 | 1009KB | `504d6af6abb882acd912d47bafa383c4512a6c8c33635e4e8fb37111d9310941` |
| NotoSansKR-Regular.woff2 | Noto Sans KR 400 (고딕·돋움 계열 대신) | 549KB | `d1bf8649914a4fe9477a8735bf056383e44e466141fb3d61897252e06d900c1a` |
| NotoSansKR-Bold.woff2 | Noto Sans KR 700 | 546KB | `dab3d492daa687386292cff1499225db580f931f800ee0d124eb0636378c6020` |

## 출처

- 글꼴 원본: Adobe·Google 의 Noto CJK (Source Han) 글꼴, https://github.com/notofonts/noto-cjk
- 이 woff2 파일들은 한글 엔진 `@rhwp/core` 프로젝트(https://github.com/edwardkim/rhwp)가 배포하는 웹 글꼴과
  바이트가 똑같아요. `@rhwp/core` 0.9.1 패키지의
  `notices/assets/fonts/licenses/font-notices.json` 에 적힌 SHA-256 과 위 값이 일치하는 것을 확인했어요.
- 한글 11,172자·자모·영문이 들어 있는 부분 글꼴이에요. 한자와 일부 기호(※ ○ □ ① 「」 → 등)는 없어서
  그 글자만 휴대폰의 기본 글꼴로 그려져요.

## 라이선스

SIL Open Font License 1.1 — 전문은 같은 폴더의 `OFL.txt` 에 있어요.
글꼴만 따로 팔 수 없고, 고친 글꼴에 예약된 이름('Source')을 쓰면 안 돼요. 앱에 함께 넣어 배포하는 것은 괜찮아요.
