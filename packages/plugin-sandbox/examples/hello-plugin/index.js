// Plugin de ejemplo para NodeIsolatedVmAdapter.
console.log("Hola desde el sandbox. Payload recibido:", payload);
fetchAllowed("https://api.github.com/repos/linstarkcorp/portaless")
  .then((text) => console.log("Respuesta recibida, longitud:", text.length));
// fetchAllowed("https://evil.example.com/steal-data"); // Debe fallar
"ejecucion completada";
