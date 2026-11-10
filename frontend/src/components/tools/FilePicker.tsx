"use client";

import { ChangeEvent, DragEvent, useId, useState } from "react";
import { ArrowDown, ArrowUp, FileText, Plus, Upload, X } from "lucide-react";
import { formatBytes } from "@/components/ToolLayout";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

type FilePickerProps = {
    /** Lower-case extensions including the dot. */
    extensions: string[];
    label: string;
    multiple?: boolean;
    compact?: boolean;
    onFiles: (files: File[]) => void;
    onError: (message: string | null) => void;
};

export function FilePicker({ extensions, label, multiple, compact, onFiles, onError }: FilePickerProps) {
    const inputId = useId();
    const [dragging, setDragging] = useState(false);

    function accept(list: FileList | null) {
        const chosen = Array.from(list ?? []);
        if (chosen.length === 0) return;
        const valid = chosen.filter((file) =>
            extensions.some((extension) => file.name.toLowerCase().endsWith(extension))
        );
        if (valid.length === 0) {
            onError(`Please choose a ${extensions.join(" or ")} file.`);
            return;
        }
        const tooBig = valid.find((file) => file.size > MAX_FILE_BYTES);
        if (tooBig) {
            onError(`${tooBig.name} is larger than the 50 MB limit.`);
            return;
        }
        onError(null);
        onFiles(multiple ? valid : valid.slice(0, 1));
    }

    function handleDrop(event: DragEvent<HTMLLabelElement>) {
        event.preventDefault();
        setDragging(false);
        accept(event.dataTransfer.files);
    }

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
        accept(event.target.files);
        event.target.value = ""; // allow choosing the same file again
    }

    const typeNames = extensions.map((extension) => extension.slice(1).toUpperCase()).join(", ");

    return (
        <label
            htmlFor={inputId}
            onDrop={handleDrop}
            onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            className={`block cursor-pointer rounded-2xl border-2 border-dashed text-center transition-colors focus-within:outline-2 focus-within:outline-accent ${
                compact ? "p-4" : "p-10 md:p-14"
            } ${dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-accent"}`}
        >
            <input
                id={inputId}
                type="file"
                multiple={multiple}
                accept={extensions.join(",")}
                onChange={handleChange}
                className="sr-only"
            />
            {compact ? (
                <span className="inline-flex items-center gap-2 text-sm font-medium text-accent">
                    <Plus className="w-4 h-4" aria-hidden />
                    {label}
                </span>
            ) : (
                <>
                    <span className="w-12 h-12 rounded-full bg-accent-soft text-accent inline-flex items-center justify-center mb-4">
                        <Upload className="w-5 h-5" aria-hidden />
                    </span>
                    <span className="block text-lg font-semibold">{dragging ? "Drop it here" : label}</span>
                    <span className="block text-sm text-ink-2 mt-1">or drag and drop</span>
                    <span className="block text-xs text-ink-3 mt-3">{typeNames}, up to 50 MB each</span>
                </>
            )}
        </label>
    );
}

export function FileCard({ file, detail, onRemove }: { file: File; detail?: string; onRemove: () => void }) {
    return (
        <div className="card px-4 py-3 flex items-center gap-3">
            <FileText className="w-5 h-5 text-ink-3 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-ink-3">{detail ?? formatBytes(file.size)}</p>
            </div>
            <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${file.name}`}
                className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
            >
                <X className="w-4 h-4" aria-hidden />
            </button>
        </div>
    );
}

export function SortableFiles({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
    function move(index: number, direction: -1 | 1) {
        const next = [...files];
        [next[index], next[index + direction]] = [next[index + direction], next[index]];
        onChange(next);
    }

    const arrow = "p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors disabled:opacity-30 disabled:pointer-events-none";

    return (
        <ol className="card divide-y divide-line">
            {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="flex items-center gap-2 pl-4 pr-2 py-2.5">
                    <span className="font-mono text-xs text-ink-3 w-5">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-ink-3">{formatBytes(file.size)}</p>
                    </div>
                    <button type="button" className={arrow} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${file.name} up`}>
                        <ArrowUp className="w-4 h-4" aria-hidden />
                    </button>
                    <button type="button" className={arrow} disabled={index === files.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${file.name} down`}>
                        <ArrowDown className="w-4 h-4" aria-hidden />
                    </button>
                    <button type="button" className={arrow} onClick={() => onChange(files.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}>
                        <X className="w-4 h-4" aria-hidden />
                    </button>
                </li>
            ))}
        </ol>
    );
}
