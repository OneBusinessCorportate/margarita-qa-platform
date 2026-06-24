import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { TABLES } from "@/lib/tables";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "No DB" }, { status: 500 });

  const patch: Record<string, unknown> = {};
  if (body.vdate !== undefined) patch.vdate = body.vdate;
  if (body.severity !== undefined) patch.severity = body.severity || null;
  if (body.violation_type !== undefined) patch.violation_type = body.violation_type || null;
  if (body.accountant !== undefined) patch.accountant = body.accountant || null;
  if (body.client !== undefined) patch.client = body.client || null;
  if (body.sanction !== undefined)
    patch.sanction =
      body.sanction === null || body.sanction === "" ? null : Number(body.sanction);
  if (body.note !== undefined) patch.note = body.note || null;

  const { data, error } = await sb
    .from(TABLES.violations)
    .update(patch)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sb = getServiceClient();
  if (!sb) return NextResponse.json({ error: "No DB" }, { status: 500 });

  const { error } = await sb
    .from(TABLES.violations)
    .delete()
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
