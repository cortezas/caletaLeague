# Escudos de los clubes

Esta carpeta está vacía a propósito.

Los escudos de los clubes y el logotipo de LaLiga son **marcas registradas**. La app
no trae ninguno: cada equipo se dibuja con un patrón de equipación original (rayas,
mitades o banda) más su sigla de 3 letras.

## Si quieres usar los escudos reales

1. Consigue los ficheros y ponlos aquí con el nombre de la sigla en mayúsculas:

   ```
   RMA.png  BAR.png  ATM.png  SEV.png  BET.png
   VAL.png  VIL.png  ATH.png  RSO.png  GIR.png
   OSA.png  CEL.png  RAY.png  GET.png  MLL.png
   ALA.png  LPA.png  ESP.png  LEG.png  VLL.png
   ```

   Cuadrados, fondo transparente, 128x128 o más. También valen `.svg`.

2. Descomenta las entradas correspondientes en
   [`src/lib/crests.ts`](../../src/lib/crests.ts), en el mapa `CREST_FILES`.

Los clubes sin fichero declarado siguen usando su patrón. Puedes mezclar.

## Nota

La responsabilidad sobre los derechos de las imágenes que añadas aquí es de quien
las añade. Para una app privada entre compañeros el riesgo práctico es nulo, pero
no lo publiques abierto ni lo subas a una tienda de aplicaciones con ellos dentro.
