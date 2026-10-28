import { Response } from "express"
import { HttpStatus } from "http-status";

interface IResponseData<T> {
    status:number;
    success: boolean;
    message: string;
    data?: T
    meta?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    }
}


export const sendResponse = <T>(res: Response, responseData: IResponseData<T>) => {

    res.status(responseData.status).json({
        success: responseData.success,
        message: responseData.message,
        data: responseData.data,
        meta: responseData.meta
    })
}