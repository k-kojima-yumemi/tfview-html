// UI text of the viewer. Terraform's own vocabulary (`will be created`,
// `# (N unchanged attributes hidden)`, `forces replacement`, ...) is not here:
// it stays as `terraform plan` prints it.

const en = {
    copied: "Copied",
    copyResourceName: "Copy resource name",
    clickToCollapse: "Click to collapse",
    clickToExpand: "Click to show all",
    markViewed: (name: string) => `Mark ${name} as viewed`,
    toggleFold: "Expand / collapse",
    updated: "updated",
    updatedCount: (n: number) => `updated ${n}`,
    carriedCount: (n: number) => `${n} viewed before`,
    noAttributeChanges: "no attribute changes",
    viewed: "viewed",
    lines: (n: number) => `${n} ${n === 1 ? "line" : "lines"}`,
    compareLabel: (label: string) => `How to compare ${label}`,
    compareByPosition: "Compare by position",
    compareIgnoringOrder: "Compare ignoring order",
    compareByField: (field: string) => `Compare by same ${field}`,
    compareByValueHint:
        "Match elements by their value instead of position (order differences are ignored)",
    compareByFieldHint:
        "Match elements by the value of a field instead of position",
    linesViewed: (done: number, total: number) =>
        `${done} / ${total} ${total === 1 ? "line" : "lines"} viewed`,
    resourceProgress: (done: number, total: number) =>
        `resource ${done} / ${total}`,
    moduleProgress: (done: number, total: number) =>
        `module ${done} / ${total}`,
    reset: "Reset",
    resetHint: "Clear all viewed state",
    language: "Language",
    confirmReset: "Clear all viewed state?",
    flashReset: "Viewed state was reset",
    storageUnavailable:
        "Cannot save state (localStorage is unavailable in this browser). Viewed state is lost when the page is closed.",
    resources: (n: number) => `${n} ${n === 1 ? "resource" : "resources"}`,
    generatedAt: (date: string) => `generated ${date}`,
    sensitiveWarning:
        "This HTML contains sensitive values in plain text (--show-sensitive). Be careful when sharing or committing it.",
    carriedNotice: (n: number) =>
        `${n} ${n === 1 ? "line" : "lines"} viewed before with the same content ${n === 1 ? "is" : "are"} collapsed as viewed`,
    updatedNotice: (n: number) =>
        `${n} ${n === 1 ? "line" : "lines"} changed since last viewed`,
    noChanges: "No changes",
};

export type Messages = typeof en;

const ja: Messages = {
    copied: "コピーしました",
    copyResourceName: "リソース名をコピー",
    clickToCollapse: "クリックで折りたたむ",
    clickToExpand: "クリックで全体を表示",
    markViewed: (name) => `${name} を確認済みにする`,
    toggleFold: "開閉",
    updated: "更新あり",
    updatedCount: (n) => `更新あり ${n}`,
    carriedCount: (n) => `前回確認済み ${n} 行`,
    noAttributeChanges: "属性の変更なし",
    viewed: "確認済み",
    lines: (n) => `${n} 行`,
    compareLabel: (label) => `${label} の比較方法`,
    compareByPosition: "位置で比較",
    compareIgnoringOrder: "順序を無視して比較",
    compareByField: (field) => `${field} が同じ要素どうしで比較`,
    compareByValueHint:
        "要素を位置ではなく、値そのもので比較する(並び順の違いは無視)",
    compareByFieldHint:
        "要素を位置ではなく、フィールドの値が同じものどうしで比較する",
    linesViewed: (done, total) => `${done} / ${total} 行 確認済み`,
    resourceProgress: (done, total) => `resource ${done} / ${total}`,
    moduleProgress: (done, total) => `module ${done} / ${total}`,
    reset: "リセット",
    resetHint: "確認済み状態をすべて消す",
    language: "言語",
    confirmReset: "確認済み状態をすべて消しますか?",
    flashReset: "確認済み状態をリセットしました",
    storageUnavailable:
        "状態を保存できません(このブラウザでは localStorage を使えません)。ページを閉じると確認済み状態は失われます。",
    resources: (n) => `${n} resources`,
    generatedAt: (date) => `生成 ${date}`,
    sensitiveWarning:
        "この HTML には sensitive な値が平文で含まれています(--show-sensitive)。共有やコミットに注意してください。",
    carriedNotice: (n) =>
        `前回確認済みで内容が同じ ${n} 行を、確認済みとして畳んでいます`,
    updatedNotice: (n) => `前回から更新あり ${n} 行`,
    noChanges: "変更はありません",
};

export const locales = { en, ja } as const;
export type Locale = keyof typeof locales;

export const localeNames: Record<Locale, string> = {
    en: "English",
    ja: "日本語",
};

export function isLocale(value: string | null | undefined): value is Locale {
    return value === "en" || value === "ja";
}

/** `?lang=` wins; otherwise the first browser language we have text for; otherwise English. */
export function detectLocale(
    search: string,
    languages: readonly string[],
): Locale {
    const param = new URLSearchParams(search).get("lang");
    if (isLocale(param)) return param;
    for (const tag of languages) {
        const base = tag.toLowerCase().split("-")[0];
        if (isLocale(base)) return base;
    }
    return "en";
}
