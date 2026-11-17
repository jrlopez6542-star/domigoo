import {
  Body,
  Catch,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SessionGuard, type AuthenticatedRequest } from "../identity/session.guard.js";
import { PrivacyRepository } from "../privacy/privacy.repository.js";
import {
  detectDocumentMime,
  MAX_DOCUMENT_BYTES,
  ObjectStorage,
} from "../storage/object-storage.js";
import { CourierFilesRepository } from "./courier-files.repository.js";

const DOCUMENT_TYPES = [
  "NATIONAL_ID",
  "DRIVER_LICENSE",
  "SOAT",
  "TECH_INSPECTION",
  "VEHICLE_PHOTO",
  "PROFILE_PHOTO",
] as const;

type UploadedBytes = {
  buffer?: Buffer;
  size?: number;
};

type JsonResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

@Catch()
class DocumentUploadFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    if (isFileTooLarge(exception)) {
      response.status(422).json({ message: "El archivo supera 10 MB" });
      return;
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(exception.getStatus())
        .json(typeof body === "string" ? { message: body } : body);
      return;
    }
    response.status(500).json({ message: "No se pudo guardar el archivo" });
  }
}

function isFileTooLarge(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "LIMIT_FILE_SIZE"
  );
}

@ApiTags("domiciliarios")
@Controller("v1/couriers/me")
@UseGuards(SessionGuard)
export class CourierFilesController {
  constructor(
    private readonly files: CourierFilesRepository,
    private readonly storage: ObjectStorage,
    private readonly privacy: PrivacyRepository,
  ) {}

  @Post("vehicle")
  @ApiOperation({ summary: "Registra la motocicleta del domiciliario" })
  async vehicle(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ id: string; type: "MOTORCYCLE"; plate: string; status: "ACTIVE" }> {
    const userId = request.auth?.userId;
    const parsed = readVehicle(body);
    if (userId === undefined || parsed === null) {
      throw new NotFoundException();
    }
    const courierId = await this.files.findCourierId(userId);
    if (courierId === null) {
      throw new NotFoundException();
    }
    const saved = await this.files.saveVehicle({ courierId, ...parsed });
    if (saved === "conflict") {
      throw new HttpException({ message: "Ya hay un vehículo activo con esa placa" }, 409);
    }
    if (saved.type !== "MOTORCYCLE" || saved.status !== "ACTIVE") {
      throw new Error("El vehículo de esta versión solo puede ser una motocicleta activa");
    }
    return { id: saved.id, type: "MOTORCYCLE", plate: saved.plate, status: "ACTIVE" };
  }

  @Post("documents")
  @UseFilters(DocumentUploadFilter)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Guarda un documento privado y su SHA-256" })
  async upload(
    @UploadedFile() file: UploadedBytes | undefined,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<{
    id: string;
    sha256: string;
    mimeType: string;
    byteSize: number;
    type: string;
    status: "UPLOADED";
  }> {
    const userId = request.auth?.userId;
    const type = readDocumentType(body);
    const expires = readOptionalDate(body);
    if (userId === undefined || type === null || expires === null) {
      throw new NotFoundException();
    }
    if (!(await this.privacy.isCurrent(userId, "DOCUMENT_STORAGE"))) {
      throw new HttpException({ message: "Hace falta el consentimiento de documentos" }, 422);
    }
    const bytes = file?.buffer;
    if (bytes === undefined || bytes.length === 0) {
      throw new HttpException({ message: "Falta el archivo" }, 422);
    }
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      throw new HttpException({ message: "El archivo supera 10 MB" }, 422);
    }
    const mimeType = detectDocumentMime(bytes);
    if (mimeType === null) {
      throw new HttpException({ message: "Tipo de archivo no permitido" }, 422);
    }
    const courierId = await this.files.findCourierId(userId);
    if (courierId === null) {
      throw new NotFoundException();
    }
    const stored = await this.storage.put(bytes, { mimeType });
    const saved = await this.files.addDocument({
      courierId,
      type,
      storageKey: stored.key,
      sha256: stored.sha256,
      mimeType,
      byteSize: bytes.length,
      declaredExpiresOn: expires.date,
    });
    if (saved.status !== "UPLOADED") {
      throw new Error("La carga no puede aceptar ni aprobar el documento");
    }
    return {
      id: saved.id,
      sha256: saved.sha256,
      mimeType: saved.mimeType,
      byteSize: saved.byteSize,
      type: saved.type,
      status: "UPLOADED",
    };
  }

  @Get("documents/:id")
  @ApiOperation({ summary: "Lee un documento propio sin publicar una URL" })
  async download(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const userId = request.auth?.userId;
    if (userId === undefined) {
      throw new NotFoundException();
    }
    const document = await this.files.findOwnedDocument(id, userId);
    if (document === null) {
      throw new NotFoundException();
    }
    const bytes = await this.storage.read(document.storageKey);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return new StreamableFile(bytes, { type: document.mimeType, length: bytes.length });
  }
}

function readVehicle(body: unknown): {
  plate: string;
  soatExpiresOn: string;
  techExpiresOn: string;
} | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record["type"] !== undefined && record["type"] !== "MOTORCYCLE") {
    return null;
  }
  if (typeof record["plate"] !== "string") {
    return null;
  }
  const plate = normalizePlate(record["plate"]);
  const soatExpiresOn = readDate(record["soatExpiresOn"]);
  const techExpiresOn = readDate(record["techExpiresOn"]);
  if (plate === null || soatExpiresOn === null || techExpiresOn === null) {
    return null;
  }
  return { plate, soatExpiresOn, techExpiresOn };
}

function normalizePlate(raw: string): string | null {
  const plate = raw.toUpperCase().replaceAll(/[\s-]/g, "");
  if (!/^[A-Z0-9]{5,6}$/.test(plate)) {
    return null;
  }
  return plate;
}

function readDocumentType(body: unknown): (typeof DOCUMENT_TYPES)[number] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const type = (body as Record<string, unknown>)["type"];
  return isDocumentType(type) ? type : null;
}

function isDocumentType(value: unknown): value is (typeof DOCUMENT_TYPES)[number] {
  return DOCUMENT_TYPES.some((item) => item === value);
}

function readOptionalDate(body: unknown): { date: string | null } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const value = (body as Record<string, unknown>)["declaredExpiresOn"];
  if (value === undefined || value === null || value === "") {
    return { date: null };
  }
  const date = readDate(value);
  return date === null ? null : { date };
}

function readDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return value;
}
