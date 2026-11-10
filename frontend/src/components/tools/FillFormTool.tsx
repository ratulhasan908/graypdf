"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Section, Toggle } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";
import { apiUpload, getErrorMessage } from "@/lib/api";

type Field = {
    name: string;
    label: string;
    type: "text" | "checkbox" | "radio" | "choice";
    value: string | boolean;
    options: string[];
    page: number;
};

export function FillFormTool() {
    const [fields, setFields] = useState<Field[] | null>(null);
    const [values, setValues] = useState<Record<string, string | boolean>>({});
    const [flatten, setFlatten] = useState(false);
    const [reading, setReading] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    function clear() {
        setFields(null);
        setValues({});
        setProblem(null);
    }

    async function load(file: File) {
        clear();
        setReading(true);
        try {
            const body = new FormData();
            body.append("files", file);
            const result = await apiUpload<{ fields: Field[] }>("/tools/form-fields/", body);
            setFields(result.fields);
            setValues(Object.fromEntries(result.fields.map((field) => [field.name, field.value])));
        } catch (err: unknown) {
            setProblem(getErrorMessage(err, "Could not read this PDF."));
        } finally {
            setReading(false);
        }
    }

    function set(name: string, value: string | boolean) {
        setValues({ ...values, [name]: value });
    }

    return (
        <SinglePdfTool
            slug="fill-pdf-form"
            action="Save completed PDF"
            fields={{ values: JSON.stringify(values), flatten: String(flatten) }}
            onReset={clear}
            onFile={(file) => {
                if (file) load(file);
                else clear();
            }}
            validate={() => (fields?.length ? null : "This PDF has no fillable fields.")}
        >
            {reading && <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto mt-8" aria-label="Reading form" />}
            {problem && <p className="mt-4 rounded-xl bg-danger-soft text-danger px-4 py-3 text-sm">{problem}</p>}
            {fields?.length === 0 && (
                <p className="mt-4 rounded-xl bg-warning-soft text-warning px-4 py-3 text-sm">
                    This PDF has no fillable fields. It may be a flat or scanned form.
                </p>
            )}
            {fields && fields.length > 0 && (
                <>
                    <div className="space-y-4 mt-6">
                        {fields.map((field) => {
                            const value = values[field.name];
                            if (field.type === "checkbox") {
                                return (
                                    <Toggle
                                        key={field.name}
                                        label={field.label}
                                        checked={Boolean(value)}
                                        onChange={(checked) => set(field.name, checked)}
                                    />
                                );
                            }
                            return (
                                <label key={field.name} className="block">
                                    <span className="block text-sm font-medium mb-1.5">{field.label}</span>
                                    {field.type === "text" ? (
                                        <input
                                            className="input"
                                            value={String(value ?? "")}
                                            onChange={(event) => set(field.name, event.target.value)}
                                        />
                                    ) : (
                                        <select
                                            className="input"
                                            value={String(value ?? "")}
                                            onChange={(event) => set(field.name, event.target.value)}
                                        >
                                            <option value="">Choose…</option>
                                            {field.options.map((option) => (
                                                <option key={option} value={option}>
                                                    {option}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </label>
                            );
                        })}
                    </div>
                    <Section title="When you're done">
                        <div className="card px-4 py-1">
                            <Toggle
                                label="Lock my answers"
                                desc="Makes the form flat, so the answers can't be changed"
                                checked={flatten}
                                onChange={setFlatten}
                            />
                        </div>
                    </Section>
                </>
            )}
        </SinglePdfTool>
    );
}
