import { errorResponse, getState, postAction } from "@/lib/paper-market";

export async function GET(request: Request) {
  try {
    return Response.json(await getState(new URL(request.url).searchParams));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await postAction(await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
}
