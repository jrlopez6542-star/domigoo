import SwaggerParser from "@apidevtools/swagger-parser";

const file = process.argv[2];
if (file === undefined || file.trim() === "") {
  process.stderr.write("Falta la ruta del documento OpenAPI\n");
  process.exit(1);
}

await SwaggerParser.validate(file);
