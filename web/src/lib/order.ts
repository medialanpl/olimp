// The saved order first, then the items it does not know yet, in their own order.
export function inOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
    return [
        ...order.flatMap((id) => items.filter((item) => item.id === id)),
        ...items.filter((item) => !order.includes(item.id)),
    ];
}
