import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import status from "http-status";
import { demoService } from "./demo.service";

const getDemo = catchAsync(async (req: Request, res: Response) => {
  const result = await demoService.getDemo();
 
  sendResponse(res, {
    status: status.OK,
    success: true,
    message: "Courses retrieved successfully",
    data: result,
  });
});




const demoController={

    getDemo
}