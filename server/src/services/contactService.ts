import { prisma } from "../db";

export async function createContact(input: { displayName: string; email?: string; whatsappNumber?: string }) {
  return prisma.contact.create({ data: input });
}

export async function listContacts() {
  return prisma.contact.findMany({ orderBy: { displayName: "asc" } });
}

/** Case-insensitive partial match on display name, for send-by-name
 * resolution (spec §5: "she says a contact's name and the assistant
 * finds the address"). */
export async function findContactsByName(name: string) {
  const all = await prisma.contact.findMany();
  const needle = name.trim().toLowerCase();
  return all.filter((c) => c.displayName.toLowerCase().includes(needle));
}
