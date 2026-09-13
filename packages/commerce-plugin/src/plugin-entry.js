async function fetchProducts(medusaUrl, publishableApiKey) {
  const url = `${medusaUrl}/store/products`;
  const text = await fetchAllowed(url, {
    headers: publishableApiKey ? { "x-publishable-api-key": publishableApiKey } : {},
  });
  const data = JSON.parse(text);
  return (data.products || []).map((p) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    thumbnail: p.thumbnail || null,
    description: p.description || "",
    variants: (p.variants || []).map((v) => ({
      id: v.id,
      prices: (v.prices || []).map((price) => ({ amount: price.amount, currency_code: price.currency_code })),
    })),
  }));
}

(async function main() {
  switch (payload.action) {
    case "isCommerceEnabled":
      return !!payload.medusaUrl;
    case "fetchProducts":
      return await fetchProducts(payload.medusaUrl, payload.publishableApiKey);
    default:
      throw new Error(`Accion desconocida: ${payload.action}`);
  }
})();
