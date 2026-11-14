# LoL 챔피언 퀴즈

`index.html` 파일 하나로 동작하는 정적 웹사이트입니다. 서버, 빌드, AI API가 필요 없습니다.

## 배포
- **GitHub Pages**: 저장소에 `index.html`을 올리고 Settings → Pages에서 켜기
- **Netlify / Vercel / Cloudflare Pages**: 폴더를 드래그해서 업로드
- 로컬 테스트: `python3 -m http.server`를 실행한 뒤 http://localhost:8000 접속

## 데이터 소스
| 용도 | Data Dragon (DD) | CommunityDragon (CD) |
|---|---|---|
| 버전 | `api/versions.json` | `latest/content-metadata.json` |
| 챔피언 목록 | `cdn/{v}/data/ko_KR/champion.json` | `{patch}/…/ko_kr/v1/champion-summary.json` |
| 챔피언 상세 | `cdn/{v}/data/ko_KR/champion/{id}.json` | `{patch}/…/ko_kr/v1/champions/{key}.json` |

DD 16.22.1을 쓸 때 CD는 `/16.22/` 경로를 씁니다(실패하면 `/latest/`).

## 상호 보강 규칙 (필드 단위)
- 이름, 칭호, 스킬 이름/쿨타임/소모값/설명, 스토리: **DD를 우선** 쓰고, 비어 있으면 CD로 채웁니다
  (CD의 `cooldownCoefficients`, `costCoefficients`, `shortBio`).
- 역할군: DD의 `tags`를 쓰고, 비어 있으면 CD의 `roles`로 채웁니다.
- 스킨: 두 소스의 스킨을 id 기준으로 **합칩니다**. 등급(rarity)과 레거시 여부는 CD에서, 이미지는 DD를 먼저 쓰고 없으면 CD를 씁니다.
- 피해 유형(물리/마법/혼합): CD의 `tacticalInfo`에만 있는 정보입니다.
- 한쪽에만 있는 챔피언(예: 출시 직후 신규 챔피언)도 포함합니다.
- 어떤 값을 어느 쪽에서 채웠는지는 설정 화면의 '보강 현황'에서 볼 수 있고, 문제를 푼 뒤 해설에 출처 배지로 표시됩니다.

## 자동 갱신 알고리즘
1. **문제는 미리 저장해 두지 않습니다.** 매번 템플릿 17종으로 현재 데이터에서 즉석으로 만듭니다.
   그래서 데이터가 바뀌면 새로 나오는 문제에 새 수치가 바로 반영됩니다.
2. **폴링**: N분(5/10/30/60/180분, 기본 30분)마다 `versions.json`과 CD `content-metadata.json`을 캐시 없이 확인합니다.
   추가로 탭으로 돌아왔을 때 확인 시각이 지났거나, 네트워크가 다시 연결되면 즉시 확인합니다.
   확인에 실패하면 간격을 2배씩, 최대 4배까지 늘립니다.
3. **변경 감지**: 스탯 해시(FNV-1a)를 localStorage 스냅샷과 비교합니다. 같은 버전 번호로 나온 핫픽스도 잡힙니다.
   스킬 쿨타임과 이름은 챔피언 상세를 불러올 때마다 이전 버전 기록과 비교합니다.
4. **풀고 있던 문제 재검증**: 각 문제는 자신이 쓴 값(deps)을 기억합니다.
   패치가 적용됐을 때 그 값이 바뀌었으면 해당 문제를 즉시 새 문제로 바꿉니다.
5. **패치 변경 문제**: 감지된 변경 목록으로 "이번 패치에서 X의 Y는 어떻게 바뀌었나요?" 문제를 자동으로 만듭니다.
6. 모드: '최신 패치 자동 추적'(기본) 또는 '16.22.1 고정'. 고정 모드에서는 새 패치가 나오면 알림만 띄웁니다.
