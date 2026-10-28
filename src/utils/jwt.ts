import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";



const createToken=(payload:JwtPayload,secret:string,{expiresIn}:SignOptions)=>{
    const token = jwt.sign(payload,secret,{expiresIn:expiresIn!});
    return token;
};


const vefifyToken=(token:string,secret:string)=>{

    try {
        
        const decoded= jwt.verify(token,secret) 
        return{
            success:true,
            data:decoded
        }
    } catch (error: unknown) {
        
        return{
            success:false,
            message:error instanceof Error ? error.message : String(error),
            error
        }
    }
}

const decodedToken=(token:string)=>{

    const decodedToken= jwt.decode(token);
    return decodedToken;
}

export const jwtUtils={
    createToken,
    vefifyToken,
    decodedToken
}
