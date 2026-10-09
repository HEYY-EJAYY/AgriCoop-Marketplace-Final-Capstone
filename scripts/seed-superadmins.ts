import "dotenv/config";
import { supabaseAdmin } from "../server/clients";
import { upsertUser } from "../server/db";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!serviceRoleKey || !supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const accounts = [
  {
    name: "Joan Athan Nelle Cahiyang",
    email: "joanathancahiyang59@gmail.com",
    password: process.env.SUPERADMIN_JOAN_PASSWORD,
    username: "HEYY_EJAYY",
  },
  {
    name: "Erol Daguinod",
    email: "heyyejayy1@gmail.com",
    password: process.env.SUPERADMIN_EROL_PASSWORD,
    username: "Jerol",
  },
] as const;

for (const account of accounts) {
  if (!account.password) throw new Error(`Missing password environment variable for ${account.username}.`);
  if (account.password.length < 12) throw new Error(`Password for ${account.username} must be at least 12 characters.`);

  const { data: listed, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw new Error(`Unable to inspect Supabase Auth users: ${listError.message}`);
  const existing = listed.users.find(user => user.email?.toLowerCase() === account.email.toLowerCase());

  const { data, error } = existing
    ? await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password: account.password,
        user_metadata: { name: account.name, username: account.username, role: "superadmin" },
      })
    : await supabaseAdmin.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true,
        user_metadata: { name: account.name, username: account.username, role: "superadmin" },
      });
  if (error || !data.user) throw new Error(`Unable to provision ${account.username}: ${error?.message ?? "unknown error"}`);

  await upsertUser({
    openId: data.user.id,
    email: account.email,
    name: account.name,
    role: "superadmin",
    approvalStatus: "approved",
    loginMethod: "supabase",
  });
  console.log(`Provisioned SuperAdmin account: ${account.username}`);
}

console.log("SuperAdmin provisioning complete. Password values were read from environment variables and were not printed or stored.");
