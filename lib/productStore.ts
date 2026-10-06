/**
 * The only way to change products.json. Server-only.
 *
 * The admin edits products while the printer sidecar writes sync state and print
 * statistics into the same file on a timer; a plain read-then-write let whichever
 * saved second undo the other — an admin's edit vanishing, or a whole product
 * created a moment ago. `change` edits the list in place and may run more than once
 * (re-applied to a fresh copy if someone saved first), so it must not do anything
 * but edit the list. Return changed: false to skip the write.
 */
import { updateJsonFile } from "./storage";
import type { Product } from "./products";

export async function mutateProducts<R>(
  change: (products: Product[]) => { result: R; changed: boolean }
): Promise<R> {
  let result!: R;
  await updateJsonFile<Product[]>("products.json", [], (list) => {
    const products = Array.isArray(list) ? list : [];
    const outcome = change(products);
    result = outcome.result;
    return outcome.changed ? products : null;
  });
  return result;
}
