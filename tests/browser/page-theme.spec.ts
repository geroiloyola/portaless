// El tema por pagina aplicado a la bio demo, en un navegador REAL. Los
// tests unitarios prueban el HTML emitido y el contrato de fuentes; aqui
// se verifica lo que importa al final: <html> lleva data-theme-pack y los
// tokens CALCULADOS de la pagina son los del tema. Se emula el SO en modo
// OSCURO a proposito: es la situacion donde una regla de tema estilo
// :root[data-theme-pack] perdia (global.css se cargue despues y su bloque
// @media tiene misma especificidad) -- el atributo inline gana igual.
import { test, expect } from "@playwright/test";

const BIO_URL = "/pages/jerry-bantz/";

test("la bio demo trae data-theme-pack y el look 2pac-dark calculado (incluso en SO oscuro)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(BIO_URL);

  await expect(page.locator("html")).toHaveAttribute("data-theme-pack", "2pac-dark");

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(20, 16, 12)"); // --bg #14100C del tema, no #261C15 del @media oscuro

  const buttonBg = await page.evaluate(() => {
    const btn = document.querySelector(".ae-link-list a");
    return btn ? getComputedStyle(btn).backgroundColor : null;
  });
  expect(buttonBg).toBe("rgb(240, 93, 35)"); // --accent #F05D23 del tema

  const textColor = await page.evaluate(() => getComputedStyle(document.body).color);
  expect(textColor).toBe("rgb(247, 247, 242)"); // --text hueso sobre fondo oscuro
});

test("una pagina sin theme se queda con el skin del sitio (sin atributo)", async ({ page }) => {
  // /trust/ usa BaseLayout y NO define tema por pagina: es la testigo del skin.
  await page.goto("/trust/");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme-pack", /.*/);

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(247, 247, 242)"); // paleta oficial clara por defecto
});
