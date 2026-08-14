# מה מומש מתוך עשרים ההצעות

מסמך זה עוקב אחר [`improvement-proposals.md`](improvement-proposals.md). ההנחיה
הייתה לממש את כל ההצעות שאינן דורשות הורדת מידע גולמי נוסף, אלא נשענות על מה
שכבר קיים במאגר. 18 מתוך 20 מומשו.

## מומש

| #   | ההצעה                                 | איפה בקוד                                                                                                         |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2   | דף בית מבוסס תובנה                    | `src/pages/HomePage.tsx`, `src/components/InsightCard.tsx`                                                        |
| 3   | ארכיטקטורת מידע ועמודי ישות           | `src/components/Layout.tsx` (ארבעה מסלולים), `src/pages/PersonPage.tsx`, `src/pages/SupplierPage.tsx`             |
| 4   | גרף מפל למחזור החיים של התקציב        | `src/lib/waterfall.ts`, `WaterfallChart` ב-`src/components/charts.tsx`, מוצג ב-`MinistryPage`                     |
| 5   | מנוע שורה תחתונה ודירוג ממצאים        | `src/lib/insights.ts`, `src/lib/summaryBuild.ts`, `takeaway` בכל גרף                                              |
| 6   | חשיפה מדורגת של אזהרות                | `QualityNote` ב-`src/components/ui.tsx`, `src/pages/HowToReadPage.tsx`                                            |
| 8   | אוצר מילים גרפי                       | `TreemapChart`, `DotPlot`, `SlopeChart`, `SmallMultiples`, `Sparkline`; קיבוץ 30 קטגוריות ב-`src/lib/taxonomy.ts` |
| 9   | תמהיל הזמן (חלקי — ראו למטה)          | `src/lib/scorecards.ts` (`subjectMatterShare`), `DiariesPage`, `PersonPage`                                       |
| 10  | ביצועים: קובץ סיכום וטעינה לפי מסך    | `scripts/build-summary.ts`, `src/data/datasets.ts`, `src/data/DataProvider.tsx`                                   |
| 11  | רצועת כהונות וייחוס לפי תקופה         | `src/lib/tenure.ts`, `src/components/TenureRibbon.tsx`                                                            |
| 12  | ציון שקיפות והפרדת אטימות מכיסוי      | `src/lib/scorecards.ts`, `src/pages/ScorecardsPage.tsx`                                                           |
| 13  | נרמול והקשר לכל מספר                  | `src/lib/context.ts`, `MeasureContext` ב-`src/components/ui.tsx`                                                  |
| 14  | מדד רכש והיגיינה של סריקת החריגים     | `procurementIndex` ו-`ruleHygiene` ב-`src/lib/scorecards.ts`, מוצגים ב-`FindingsPage`                             |
| 15  | מובייל וטבלאות ענק                    | תצוגת כרטיסים ב-`src/components/DataTable.tsx`                                                                    |
| 16  | מצב בכתובת, קישורי-קבע וחיפוש גלובלי  | `src/lib/useUrlState.ts`, `CopyLinkButton`, `src/components/CommandSearch.tsx`                                    |
| 17  | מערכת עיצוב, טיפוגרפיה עברית ומצב כהה | `src/index.css`, `tailwind.config.js`, `public/fonts/` (Heebo מקומי, 42KB), מפסק ב-`Layout`                       |
| 18  | ניתוח תזמון פגישות מול התקשרויות      | `src/lib/timing.ts`, מוצג ב-`SupplierPage`                                                                        |
| 19  | זהות מפעיל, זכות תגובה ויומן תיקונים  | `src/lib/corrections.ts`, `src/pages/CorrectionsPage.tsx`, `ReportErrorLink`                                      |
| 20  | "מאה השקלים שלך"                      | `src/components/HundredShekel.tsx`, בדף הבית                                                                      |

## לא מומש, ולמה

**הצעה 1 — שדרת "החלטה → משימה → תקציב → ביצוע → תוצאה".** דורשת איסוף שני מקורות
חדשים מ-data.gov.il: מעקב ביצוע משימות החלטות ממשלה (2,243 משימות, 278 החלטות) ודוחות
ביצוע תוכניות העבודה (2023–2025). זו הצעה בעלת ההשפעה הגדולה ביותר, והיא הדבר הבא
לעשות — הפירוט הטכני, כולל שמות השדות ונקודת ה-API, נמצא ב-`improvement-proposals.md`.

**הצעה 7 — מונחים ריאליים.** דורשת את מדד המחירים לצרכן מהלמ"ס. הזנת ערכי מדד
מהזיכרון הייתה מפרה את הכלל המרכזי של הפרויקט — שאין באתר מספר ממקור עקיף או משוער —
ולכן לא נעשתה. במקומה, כל שינוי רב-שנתי באתר מסומן במפורש כנומינלי
(`CHANGE_IS_NOMINAL_HE` ב-`src/lib/context.ts`), והמגבלה מוסברת במסך "איך לקרוא את
האתר". התשתית להצגת מפסק נומינלי/ריאלי תהיה שינוי מקומי לאחר שהמדד ייאסף.

**הצעה 13 — לנפש.** נרמול לנתח ולדירוג מומש; הוצאה לנפש לא, כי היא דורשת נתוני
אוכלוסייה שאינם במאגר.

**הצעה 9 — כסף מול זמן.** מומש הצד שאפשר: תמהיל הזמן, מקובץ לשמונה קבוצות, כולל
"חלק העיסוק בתוכן". ההשוואה לתמהיל התקציב לא נבנתה, וזו החלטה ולא השמטה: התקציב
מסווג לפי מבנה (שכר, קניות, העברות, רזרבות) ולא לפי תחום מדיניות, הסיווג התמטי הקיים
מכסה 5 מתוך 43 סעיפים, וקובץ הקישור בין פעילות לתקציב ריק. מיפוי בין קבוצות היומן
לתמות התקציב היה מייצר פער מדיד למראה בין שני צירים שאינם מודדים אותו דבר. ההסבר הזה
מוצג בתוך האתר (`NO_MONEY_VS_TIME_HE`), כדי שההיעדר יהיה מוצהר.

## מה נבדק

- `npm run typecheck`, `npm run lint`, `npm run format:check` — נקיים.
- `npm test` — 191 בדיקות עוברות, מהן 35 חדשות (`tests/derived.test.ts`) על שכבת
  הגזירה: null במקום אפס, פערי הכיסוי שלנו אינם מורידים ציון לאף משרד, וכל תובנה
  נושאת "מה זה לא אומר".
- `npm run e2e` — 86 בדיקות עוברות בדסקטופ ובמובייל, כולל המסכים החדשים, שמירת
  המסננים בכתובת, ומצב כהה.
- `npm run build` — עובר. המסך הראשון נטען מ-`index.js` (206KB) ומ-`site-summary.json`
  (71KB) במקום מ-12.1MB של JSON.
