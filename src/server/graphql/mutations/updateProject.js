import {GraphQLNonNull} from 'graphql';
import ms from 'ms';
import getRethink from 'server/database/rethinkDriver';
import getUsersToIgnore from 'server/graphql/mutations/helpers/getUsersToIgnore';
import publishChangeNotifications from 'server/graphql/mutations/helpers/publishChangeNotifications';
import AreaEnum from 'server/graphql/types/AreaEnum';
import UpdateProjectInput from 'server/graphql/types/UpdateProjectInput';
import UpdateProjectPayload from 'server/graphql/types/UpdateProjectPayload';
import {getUserId, requireTeamMember} from 'server/utils/authorization';
import publish from 'server/utils/publish';
import {handleSchemaErrors} from 'server/utils/utils';
import shortid from 'shortid';
import {PROJECT} from 'universal/utils/constants';
import getTagsFromEntityMap from 'universal/utils/draftjs/getTagsFromEntityMap';
import makeProjectSchema from 'universal/validation/makeProjectSchema';

const DEBOUNCE_TIME = ms('5m');

export default {
  type: UpdateProjectPayload,
  description: 'Update a project with a change in content, ownership, or status',
  args: {
    area: {
      type: AreaEnum,
      description: 'The part of the site where the creation occurred'
    },
    updatedProject: {
      type: new GraphQLNonNull(UpdateProjectInput),
      description: 'the updated project including the id, and at least one other field'
    }
  },
  async resolve(source, {area, updatedProject}, {authToken, dataLoader, socketId: mutatorId}) {
    const r = getRethink();
    const now = new Date();
    const operationId = dataLoader.share();
    const subOptions = {mutatorId, operationId};

    // AUTH
    const viewerId = getUserId(authToken);
    const {id: projectId} = updatedProject;
    const [teamId] = projectId.split('::');
    requireTeamMember(authToken, teamId);

    // VALIDATION
    const schema = makeProjectSchema();
    const {errors, data: validUpdatedProject} = schema(updatedProject);
    handleSchemaErrors(errors);

    // RESOLUTION
    const {agendaId, content, status, userId: projectUserId, sortOrder} = validUpdatedProject;

    const newProject = {
      agendaId,
      content,
      status,
      userId: projectUserId,
      tags: content ? getTagsFromEntityMap(JSON.parse(content).entityMap) : undefined,
      teamId,
      teamMemberId: projectUserId ? `${projectUserId}::${teamId}` : undefined,
      sortOrder
    };

    let projectHistory;
    if (Object.keys(updatedProject).length > 2 || newProject.sortOrder === undefined) {
      // if this is anything but a sort update, log it to history
      newProject.updatedAt = now;
      const mergeDoc = {
        content,
        projectId,
        status,
        teamMemberId: newProject.teamMemberId,
        updatedAt: now,
        tags: newProject.tags
      };
      projectHistory = r.table('ProjectHistory')
        .between([projectId, r.minval], [projectId, r.maxval], {index: 'projectIdUpdatedAt'})
        .orderBy({index: 'projectIdUpdatedAt'})
        .nth(-1)
        .default({updatedAt: r.epochTime(0)})
        .do((lastDoc) => {
          return r.branch(
            lastDoc('updatedAt').gt(r.epochTime((now - DEBOUNCE_TIME) / 1000)),
            r.table('ProjectHistory').get(lastDoc('id')).update(mergeDoc),
            r.table('ProjectHistory').insert(lastDoc.merge(mergeDoc, {id: shortid.generate()}))
          );
        });
    }
    const {projectChanges, teamMembers} = await r({
      projectChanges: r.table('Project').get(projectId).update(newProject, {returnChanges: true})('changes')(0).default(null),
      history: projectHistory,
      teamMembers: r.table('TeamMember')
        .getAll(teamId, {index: 'teamId'})
        .filter({
          isNotRemoved: true
        })
        .coerceTo('array')
    });
    const usersToIgnore = getUsersToIgnore(area, teamMembers);
    if (!projectChanges) {
      throw new Error('Project already updated or does not exist');
    }

    // send project updated messages
    const {new_val: project, old_val: oldProject} = projectChanges;
    const isPrivate = project.tags.includes('private');
    const wasPrivate = oldProject.tags.includes('private');
    const isPrivatized = isPrivate && !wasPrivate;
    const isPublic = !isPrivate || isPrivatized;

    // get notification diffs
    const {notificationsToRemove, notificationsToAdd} = await publishChangeNotifications(project, oldProject, viewerId, usersToIgnore);
    const data = {isPrivatized, projectId, notificationsToAdd, notificationsToRemove};
    teamMembers.forEach(({userId}) => {
      if (isPublic || userId === projectUserId) {
        publish(PROJECT, userId, UpdateProjectPayload, data, subOptions);
      }
    });

    return data;
  }
};
