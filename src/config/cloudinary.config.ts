import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import status from "http-status";
import AppError from "../errorHelpers/AppError";
import { envVars } from "./env";

cloudinary.config({
    cloud_name: envVars.CLOUDINARY.CLOUDINARY_CLOUD_NAME,
    api_key: envVars.CLOUDINARY.CLOUDINARY_API_KEY,
    api_secret: envVars.CLOUDINARY.CLOUDINARY_API_SECRET,
});


export const uploadFileToCloudinary = async (
    buffer: Buffer,
    fileName: string,
    subfolder?: string,
): Promise<UploadApiResponse> => {

    if (!buffer || !fileName) {
        throw new AppError(status.BAD_REQUEST, "File buffer and file name are required for upload");
    }

    const extension = fileName.split(".").pop()?.toLocaleLowerCase();

    const fileNameWithoutExtension = fileName
        .split(".")
        .slice(0, -1)
        .join(".")
        .toLowerCase()
        .replace(/\s+/g, "-")
        // eslint-disable-next-line no-useless-escape
        .replace(/[^a-z0-9\-]/g, "");

    const uniqueName =
        Math.random().toString(36).substring(2) +
        "-" +
        Date.now() +
        "-" +
        fileNameWithoutExtension;

    // Determine folder and resource type based on extension
    const isPdf = extension === "pdf";
    const defaultFolder = isPdf ? "pdfs" : "images";
    const folderPath = subfolder
        ? `nexora/${subfolder}`
        : `nexora/${defaultFolder}`;

    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
            {
                resource_type: isPdf ? "raw" : "auto",
                // Only use public_id (includes the folder path) — do NOT also set
                // the `folder` option, because that would double-nest the path.
                public_id: `${folderPath}/${uniqueName}${isPdf ? ".pdf" : ""}`,
            },
            (error, result) => {
                if (error) {
                    return reject(new AppError(status.INTERNAL_SERVER_ERROR, "Failed to upload file to Cloudinary"));
                }
                resolve(result as UploadApiResponse);
            }
        ).end(buffer);
    });
};


export const deleteFileFromCloudinary = async (url: string) => {

    try {
        const regex = /\/v\d+\/(.+?)(?:\.[a-zA-Z0-9]+)+$/;

        const match = url.match(regex);

        if (match && match[1]) {
            const publicId = match[1];

            // Detect resource_type from the Cloudinary URL structure
            const isRaw = url.includes("/raw/upload/");
            const resourceType = isRaw ? "raw" : "image";

            await cloudinary.uploader.destroy(
                publicId, {
                resource_type: resourceType,
            });
        }

    } catch (error) {
        console.error("Error deleting file from Cloudinary:", error);
        throw new AppError(status.INTERNAL_SERVER_ERROR, "Failed to delete file from Cloudinary");
    }
};


export const cloudinaryUpload = cloudinary;