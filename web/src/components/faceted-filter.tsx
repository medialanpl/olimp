import { PlusCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Option = { value: string; label: string; count?: number };

type FacetedFilterProps = {
    title: string;
    options: Option[];
    selected: string[];
    onSelectedChange: (next: string[]) => void;
    labels: { empty: string; clear: string };
};

export function FacetedFilter({
    title,
    options,
    selected,
    onSelectedChange,
    labels,
}: FacetedFilterProps) {
    const toggle = (value: string) =>
        onSelectedChange(
            selected.includes(value)
                ? selected.filter((item) => item !== value)
                : [...selected, value],
        );

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="border-dashed">
                    <PlusCircle />
                    {title}
                    {selected.length > 0 && (
                        <Badge variant="secondary" className="tabular-nums">
                            {selected.length}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-0">
                <Command>
                    <CommandInput placeholder={title} />
                    <CommandList>
                        <CommandEmpty>{labels.empty}</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.label}
                                    data-checked={selected.includes(option.value)}
                                    onSelect={() => toggle(option.value)}
                                >
                                    <span className="flex-1">{option.label}</span>
                                    {option.count !== undefined && (
                                        <span className="text-xs text-muted-foreground tabular-nums">
                                            {option.count}
                                        </span>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                        {selected.length > 0 && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={() => onSelectedChange([])}
                                        className="justify-center"
                                    >
                                        {labels.clear}
                                    </CommandItem>
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
