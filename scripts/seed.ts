// Seed a real Supabase instance from the shared seed data. Requires
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
//
//   npm run seed
//
// Idempotent-ish: upserts chats/accountants/criteria; evaluations/tasks are
// upserted by id. Run db/schema.sql first to create the tables.
import { createClient } from "@supabase/supabase-js";
import { CRITERIA } from "../src/lib/scoring";
import {
  seedAccountants,
  seedChats,
  seedEvaluations,
  seedTasks,
} from "../src/lib/seed-data";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. " +
        "Set them in your environment (e.g. .env.local) before seeding."
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log("Seeding accountants…");
  let { error } = await sb.from("accountants").upsert(seedAccountants);
  if (error) throw error;

  console.log("Seeding chats…");
  ({ error } = await sb.from("chats").upsert(seedChats));
  if (error) throw error;

  console.log("Seeding criteria…");
  ({ error } = await sb.from("criteria").upsert(
    CRITERIA.map((c) => ({
      id: c.id,
      name: c.name,
      weight: c.weight,
      scale_max: c.scaleMax,
      descriptions: c.descriptions,
    }))
  ));
  if (error) throw error;

  console.log("Seeding evaluations…");
  ({ error } = await sb.from("evaluations").upsert(seedEvaluations));
  if (error) throw error;

  console.log("Seeding tasks…");
  ({ error } = await sb.from("tasks").upsert(seedTasks));
  if (error) throw error;

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
