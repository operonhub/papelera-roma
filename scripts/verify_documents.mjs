import fs from "node:fs/promises";
import vm from "node:vm";
import { Workbook } from "@oai/artifact-tool";

const root = new URL("../", import.meta.url);
const tmpDir = new URL("../tmp/pdfs/", import.meta.url);
await fs.mkdir(tmpDir, { recursive: true });

const csvText = await fs.readFile(new URL("data/productos_papelera_roma.csv", root), "utf8");
const workbook = await Workbook.fromCSV(csvText, { sheetName: "Productos" });
const values = workbook.worksheets.getItemAt(0).getUsedRange().values;
const headers = values[0].map(String);
const priceFields = [
  { key: "precio_unidad", label: "Unidad" },
  { key: "precio_10", label: "x 10" },
  { key: "precio_50", label: "x 50" },
  { key: "precio_100", label: "x 100" },
  { key: "precio_bulto", label: "Bulto" },
];
const products = values.slice(1).map((row) => {
  const product = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
  for (const { key } of priceFields) product[key] = product[key] === "" ? null : Number(product[key]);
  return product;
});

const documentContext = { window: {} };
vm.createContext(documentContext);
vm.runInContext(await fs.readFile(new URL("documentos.js", root), "utf8"), documentContext);
const docs = documentContext.window.RomaDocuments;
const listBytes = docs.buildPriceListPdf({
  items: products,
  title: "Lista para comercios",
  client: "Cliente de prueba",
  date: "12/08/2026",
  priceFields,
});
const quoteItems = products.slice(0, 3).map((product, index) => {
  const field = priceFields.find(({ key }) => typeof product[key] === "number");
  const quantity = index + 1;
  return {
    code: product.codigo,
    name: product.nombre,
    category: product.categoria,
    priceLabel: field.label,
    quantity,
    unitPrice: product[field.key],
    amount: product[field.key] * quantity,
  };
});
const quote = {
  number: "123456",
  client: "Almacén Don José",
  address: "Monte Chingolo",
  validity: "7 días",
  notes: "Entrega a coordinar. Precios sujetos a confirmación.",
  date: "12/08/2026",
  items: quoteItems,
  subtotal: quoteItems.reduce((sum, item) => sum + item.amount, 0),
};
const quoteBytes = docs.buildQuotePdf(quote);
await fs.writeFile(new URL("lista-verificacion.pdf", tmpDir), listBytes);
await fs.writeFile(new URL("presupuesto-verificacion.pdf", tmpDir), quoteBytes);

const appContext = {
  document: { addEventListener() {} },
  window: {},
  navigator: {},
  localStorage: {},
  console,
  Intl,
  Date,
  Blob,
  URL,
  setTimeout,
  clearTimeout,
};
appContext.window = appContext;
appContext.__quote = quote;
vm.createContext(appContext);
vm.runInContext(await fs.readFile(new URL("app.js", root), "utf8"), appContext);
const quoteXml = vm.runInContext("quoteExcelDocument(__quote)", appContext);
await fs.writeFile(new URL("presupuesto-verificacion.xls", tmpDir), quoteXml, "utf8");

const audit = await workbook.inspect({
  kind: "table",
  range: "Productos!A1:M4",
  include: "values",
  tableMaxRows: 4,
  tableMaxCols: 13,
});
console.log(JSON.stringify({
  productsUsed: products.length,
  listPdfBytes: listBytes.length,
  quotePdfBytes: quoteBytes.length,
  quoteTotal: quote.subtotal,
  quoteExcelHasFormula: quoteXml.includes('ss:Formula="=RC[-6]*RC[-1]"'),
  sourcePreview: audit.ndjson,
}));
