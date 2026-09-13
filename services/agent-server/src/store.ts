import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CreateGenerationRequest, GenerationEvent, GenerationState, Project } from '../../../contracts/src/generation.ts';
import type { PackageSetRequest } from '../../../contracts/src/package-set.ts';
import type { VfsFiles } from '../../../contracts/src/runtime.ts';
import type { AccessClaims, ProjectMembership, ProjectRole } from '../../../contracts/src/auth.ts';
import { PROJECT_ROLE_RANK } from '../../../contracts/src/auth.ts';
import { HttpError } from './schema.ts';
import { defaultPackageSet, templateFiles } from './templates.ts';
export interface GenerationRecord {
  generationId: string; request: CreateGenerationRequest; state: GenerationState;
  createdAt: string;
  files: VfsFiles; packageSet: PackageSetRequest; events: GenerationEvent[];
}
export class Store {
  projects = new Map<string, Project>();
  memberships = new Map<string, ProjectMembership>();
  generations = new Map<string, GenerationRecord>();
  requestIds = new Map<string, string>();
  constructor(readonly directory: string) {
    for (const kind of ['projects', 'generations', 'memberships']) mkdirSync(join(directory, kind), { recursive: true });
    for (const file of readdirSync(join(directory, 'projects')).filter(file => file.endsWith('.json'))) {
      const project: Project = JSON.parse(readFileSync(join(directory, 'projects', file), 'utf8'));
      this.projects.set(project.projectId, project);
    }
    for (const file of readdirSync(join(directory, 'memberships')).filter(file => file.endsWith('.json'))) {
      const membership: ProjectMembership = JSON.parse(readFileSync(join(directory, 'memberships', file), 'utf8'));
      this.memberships.set(membership.projectId, membership);
    }
    for (const file of readdirSync(join(directory, 'generations')).filter(file => file.endsWith('.json'))) {
      const generation: GenerationRecord = JSON.parse(readFileSync(join(directory, 'generations', file), 'utf8'));
      this.generations.set(generation.generationId, generation);
      this.requestIds.set(generation.request.requestId, generation.generationId);
    }
  }
  private write(kind: string, id: string, value: unknown) {
    const file = join(this.directory, kind, id + '.json');
    const temp = file + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
    renameSync(temp, file);
  }
  project(id: string): Project {
    const project = this.projects.get(id);
    if (!project) throw new HttpError(404, 'project not found');
    return structuredClone(project);
  }
  createProject(name: string, apiIds: string[], identity?: AccessClaims): Project {
    const project: Project = { projectId: randomUUID(), name, revision: 1, files: templateFiles(apiIds[0]), packageSet: structuredClone(defaultPackageSet), apiIds, updatedAt: new Date().toISOString() };
    if (identity) this.saveMembership({ projectId: project.projectId, teamId: identity.groups[0] ?? '', version: 1, members: [{ sub: identity.sub, username: identity.preferred_username, role: 'owner', addedAt: new Date().toISOString(), addedBy: identity.sub }] });
    this.write('projects', project.projectId, project);
    this.projects.set(project.projectId, project);
    return structuredClone(project);
  }
  save(id: string, baseRevision: number, files: VfsFiles, packageSet?: PackageSetRequest): Project {
    // No await between comparison and atomic replacement: single-process CAS linearization.
    const current = this.project(id);
    if (current.revision !== baseRevision) throw new HttpError(409, 'conflict', { currentRevision: current.revision });
    const project = { ...current, files: structuredClone(files), packageSet: structuredClone(packageSet ?? current.packageSet), revision: current.revision + 1, updatedAt: new Date().toISOString() };
    this.write('projects', id, project);
    this.projects.set(id, project);
    return structuredClone(project);
  }
  membership(id: string): ProjectMembership {
    const value = this.memberships.get(id);
    if (!value || !this.projects.has(id)) throw new HttpError(404, 'project not found');
    return structuredClone(value);
  }
  requireMember(id: string, sub: string, minimum: ProjectRole = 'viewer') {
    const membership = this.membership(id);
    const member = membership.members.find(m => m.sub === sub);
    if (!member) throw new HttpError(404, 'project not found');
    if (PROJECT_ROLE_RANK[member.role] < PROJECT_ROLE_RANK[minimum]) throw new HttpError(403, 'project role forbidden');
    return member;
  }
  private saveMembership(value: ProjectMembership) {
    this.write('memberships', value.projectId, value);
    this.memberships.set(value.projectId, value);
    return structuredClone(value);
  }
  updateMember(id: string, actor: string, sub: string, username: string, role?: ProjectRole) {
    this.requireMember(id, actor, 'owner');
    const value = this.membership(id), existing = value.members.find(m => m.sub === sub);
    if (existing?.role === 'owner' && role !== 'owner' && value.members.filter(m => m.role === 'owner').length === 1) throw new HttpError(409, 'last owner required');
    value.members = value.members.filter(m => m.sub !== sub);
    if (role) value.members.push({ sub, username, role, addedAt: existing?.addedAt ?? new Date().toISOString(), addedBy: existing?.addedBy ?? actor });
    value.version++;
    return this.saveMembership(value);
  }
  persist(record: GenerationRecord) { this.write('generations', record.generationId, record); }
  generation(id: string): GenerationRecord {
    const record = this.generations.get(id);
    if (!record) throw new HttpError(404, 'generation not found');
    return record;
  }
}
