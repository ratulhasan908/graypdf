"use client";

import { ReactNode, useId } from "react";

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return (
        <fieldset className="mt-6">
            <legend className="text-sm font-medium mb-2">{title}</legend>
            {children}
            {hint && <p className="text-xs text-ink-3 mt-2">{hint}</p>}
        </fieldset>
    );
}

export type Choice<T> = { value: T; title: string; desc?: string; badge?: string };

export function ChoiceCards<T extends string | number>({
    value,
    options,
    onChange,
    columns = 1,
}: {
    value: T;
    options: Choice<T>[];
    onChange: (value: T) => void;
    columns?: 1 | 2 | 3;
}) {
    const name = useId();
    const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
    return (
        <div className={`grid gap-2 ${grid}`}>
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <label
                        key={String(option.value)}
                        className={`relative cursor-pointer rounded-xl border px-4 py-3 transition-colors focus-within:outline-2 focus-within:outline-accent ${
                            active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong"
                        }`}
                    >
                        <input
                            type="radio"
                            name={name}
                            className="sr-only"
                            checked={active}
                            onChange={() => onChange(option.value)}
                        />
                        <span className="flex items-center gap-2 text-sm font-medium">
                            {option.title}
                            {option.badge && (
                                <span className="text-[11px] font-medium text-accent bg-surface border border-line rounded-full px-1.5 py-px">
                                    {option.badge}
                                </span>
                            )}
                        </span>
                        {option.desc && <span className="block text-xs text-ink-2 mt-0.5">{option.desc}</span>}
                    </label>
                );
            })}
        </div>
    );
}

export function Toggle({
    label,
    desc,
    checked,
    onChange,
}: {
    label: string;
    desc?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex items-center justify-between gap-4 cursor-pointer py-2">
            <span>
                <span className="block text-sm font-medium">{label}</span>
                {desc && <span className="block text-xs text-ink-2">{desc}</span>}
            </span>
            <input
                type="checkbox"
                role="switch"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="sr-only peer"
            />
            <span
                aria-hidden
                className="relative w-10 h-6 shrink-0 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4"
            />
        </label>
    );
}

export function NumberField({
    label,
    value,
    min,
    max,
    step,
    onChange,
}: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="block text-sm">
            <span className="block text-ink-2 mb-1">{label}</span>
            <input
                type="number"
                className="input"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(event) => onChange(Number(event.target.value) || 0)}
            />
        </label>
    );
}

export function RangeField({
    label,
    display,
    value,
    min,
    max,
    step,
    onChange,
}: {
    label: string;
    display: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="block text-sm">
            <span className="flex justify-between text-ink-2 mb-1">
                {label}
                <span className="font-mono text-ink">{display}</span>
            </span>
            <input
                type="range"
                className="w-full accent-[var(--accent)]"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(event) => onChange(Number(event.target.value))}
            />
        </label>
    );
}
