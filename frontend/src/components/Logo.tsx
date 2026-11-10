export default function Logo() {
    return (
        <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-[17px] leading-none text-ink">
            <svg width="22" height="26" viewBox="0 0 22 26" className="block shrink-0" aria-hidden>
                <path d="M2 0h12l8 8v16a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2Z" fill="var(--ink)" />
                <path d="M14 0l8 8h-6a2 2 0 0 1-2-2V0Z" fill="var(--accent)" />
                <rect x="4.5" y="13" width="13" height="2" rx="1" fill="#fff" opacity=".85" />
                <rect x="4.5" y="18" width="8.5" height="2" rx="1" fill="#fff" opacity=".55" />
            </svg>
            <span className="block">
                Grey<span className="text-accent">PDF</span>
            </span>
        </span>
    );
}
