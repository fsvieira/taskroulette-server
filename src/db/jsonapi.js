function taskToJSONAPI({
    id,
    done,
    deleted,
    done_until,
    created_at,
    updated_at,
    ...attr
}) {
    return {
        id,
        type: "task",
        attributes: {
            done: !!done,
            deleted: !!deleted,
            "done-until": done_until ? moment.unix(done_until).valueOf() : null,
            "created-at": moment.unix(created_at).valueOf(),
            "updated-at": moment.unix(updated_at).valueOf(),
            ...attr
        },
        relationships: {
            // TODO: get tags.
            tags: {
                data: [{ type: "tag", id: "all" }]
            }
        }
    };
}

function tasksToJSONAPI(tasks) {
    return tasks.map(taskToJSONAPI);
}

module.exports = {
    taskToJSONAPI,
    tasksToJSONAPI
}