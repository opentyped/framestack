// A data provider for refine (or any client) over the crud router.
import { CodeError, ErrorCode } from "@opentyped/framestack-error";

import type { Filter, Sorter } from "./types.js";

export interface ListParams {
  resource: string;
  pagination?: {
    currentPage?: number;
    pageSize?: number;
    mode?: "server" | "off";
  };
  filters?: Filter[];
  sorters?: Sorter[];
}

interface Call {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

/** Calls `${base}/:resource…`; errors reject as CodeErrors. */
export function crudClient(base: string) {
  /** Send JSON; error responses and network failures reject as CodeErrors. */
  const call = async <T>(init: Call): Promise<T> => {
    const query = new URLSearchParams(init.query).toString();
    let response: Response;

    try {
      response = await fetch(init.path + (query ? `?${query}` : ""), {
        method: init.method ?? "GET",
        headers:
          init.body === undefined ? {} : { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (error) {
      throw new CodeError(
        ErrorCode.Unavailable,
        { message: "network request failed" },
        { cause: error },
      );
    }

    if (!response.ok) {
      throw CodeError.fromJSON(await response.json().catch(() => null));
    }

    return (response.status === 204 ? null : await response.json()) as T;
  };
  const path = (resource: string, id?: string | number) =>
    `${base}/${encodeURIComponent(resource)}${id === undefined ? "" : `/${encodeURIComponent(id)}`}`;

  return {
    getApiUrl: () => base,

    getList<T>({ resource, pagination, filters, sorters }: ListParams) {
      const {
        currentPage = 1,
        pageSize = 10,
        mode = "server",
      } = pagination ?? {};
      const query: Record<string, string> = {};

      if (mode === "server") {
        query.offset = String((currentPage - 1) * pageSize);
        query.limit = String(pageSize);
      }

      if (sorters?.length) {
        query.sort = sorters
          .map((sorter) => `${sorter.field}.${sorter.order}`)
          .join(",");
      }

      if (filters?.length) {
        query.filters = JSON.stringify(filters);
      }

      return call<{ data: T[]; total: number }>({
        path: path(resource),
        query,
      });
    },

    getMany<T>({
      resource,
      ids,
    }: {
      resource: string;
      ids: (string | number)[];
    }) {
      return this.getList<T>({
        resource,
        pagination: { mode: "off" },
        filters: [{ field: "id", operator: "in", value: ids }],
      });
    },

    getOne<T>({ resource, id }: { resource: string; id: string | number }) {
      return call<{ data: T }>({ path: path(resource, id) });
    },

    create<T>({
      resource,
      variables,
    }: {
      resource: string;
      variables: object;
    }) {
      return call<{ data: T }>({
        method: "POST",
        path: path(resource),
        body: variables,
      });
    },

    createMany<T>({
      resource,
      variables,
    }: {
      resource: string;
      variables: object[];
    }) {
      return call<{ data: T[] }>({
        method: "POST",
        path: path(resource),
        body: variables,
      });
    },

    update<T>({
      resource,
      id,
      variables,
    }: {
      resource: string;
      id: string | number;
      variables: object;
    }) {
      return call<{ data: T }>({
        method: "PATCH",
        path: path(resource, id),
        body: variables,
      });
    },

    deleteOne<T>({ resource, id }: { resource: string; id: string | number }) {
      return call<{ data: T }>({ method: "DELETE", path: path(resource, id) });
    },

    deleteMany<T>({
      resource,
      ids,
    }: {
      resource: string;
      ids: (string | number)[];
    }) {
      return call<{ data: T[] }>({
        method: "DELETE",
        path: path(resource),
        body: { filters: [{ field: "id", operator: "in", value: ids }] },
      });
    },
  };
}
