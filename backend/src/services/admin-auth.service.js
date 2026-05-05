import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { getSequelize } from "../db/sequelize.js";

/**
 * @param {string} email
 * @param {string} password
 */
export async function adminLogin(email, password) {
  if (!config.admin.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  const sequelize = getSequelize();
  if (!sequelize) throw new Error("Database not available");

  const { AdminUser, AdminRole } = sequelize.models;
  const user = await AdminUser.findOne({
    where: { email: String(email || "").trim().toLowerCase() },
    include: [{ model: AdminRole, as: "roles", through: { attributes: [] }, required: false }],
  });
  if (!user) throw new Error("Invalid credentials");
  const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
  if (!ok) throw new Error("Invalid credentials");

  const plain = user.get({ plain: true });
  const token = jwt.sign({ sub: plain.id, email: plain.email }, config.admin.jwtSecret, { expiresIn: "7d" });
  return {
    token,
    user: {
      id: plain.id,
      email: plain.email,
      displayName: plain.displayName,
      language: plain.language,
      roles: (plain.roles || []).map((r) => ({ id: r.id, name: r.name, slug: r.slug })),
    },
  };
}

/**
 * @param {string} userId
 */
export async function adminMe(userId) {
  const sequelize = getSequelize();
  if (!sequelize) throw new Error("Database not available");
  const { AdminUser, AdminRole } = sequelize.models;
  const user = await AdminUser.findByPk(userId, {
    attributes: { exclude: ["passwordHash"] },
    include: [{ model: AdminRole, as: "roles", through: { attributes: [] }, required: false }],
  });
  if (!user) return null;
  const plain = user.get({ plain: true });
  return {
    id: plain.id,
    email: plain.email,
    displayName: plain.displayName,
    language: plain.language,
    avatarUrl: plain.avatarUrl,
    roles: (plain.roles || []).map((r) => ({ id: r.id, name: r.name, slug: r.slug })),
  };
}
