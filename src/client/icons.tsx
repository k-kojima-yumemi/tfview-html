// Icons drawn with `currentColor`, so they follow the text color (dark mode, the copied state).
// Fill and stroke are set in styles.css by the button that holds them.
import type { FC } from "hono/jsx";

/** Points right; the folding button rotates it to point down when open. */
export const CaretIcon: FC = () => {
    return (
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M6 3.5l4.5 4.5L6 12.5" />
        </svg>
    );
};

export const CopyIcon: FC = () => {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
        </svg>
    );
};

export const CheckIcon: FC = () => {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 8.5l3 3 7-7" />
        </svg>
    );
};
