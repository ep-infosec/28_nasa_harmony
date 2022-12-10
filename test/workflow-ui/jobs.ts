import * as mustache from 'mustache';
import { expect } from 'chai';
import request from 'supertest';
import { describe, it, before } from 'mocha';
import { JobStatus } from '../../app/models/job';
import hookServersStartStop from '../helpers/servers';
import { hookTransaction, truncateAll } from '../helpers/db';
import { buildJob } from '../helpers/jobs';
import { workflowUIJobs, hookWorkflowUIJobs, hookAdminWorkflowUIJobs } from '../helpers/workflow-ui';
import env from '../../app/util/env';
import { auth } from '../helpers/auth';
import { renderNavLink } from './helpers';

// Example jobs to use in tests
const woodyJob1 = buildJob({
  username: 'woody',
  status: JobStatus.SUCCESSFUL,
  message: 'Completed successfully',
  progress: 100,
  links: [{ href: 'http://example.com/woody1', rel: 'link', type: 'text/plain' }],
  request: 'http://example.com/harmony?request=woody1&turbo=false',
  isAsync: true,
  numInputGranules: 89723,
});

const woodyJob2 = buildJob({
  username: 'woody',
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 60,
  links: [{ href: 's3://somebucket/mydata', rel: 'data', type: 'image/tiff' }],
  request: 'http://example.com/harmony?request=woody2&turbo=true',
  isAsync: true,
  numInputGranules: 35051,
});

const woodySyncJob = buildJob({
  username: 'woody',
  status: JobStatus.FAILED,
  message: 'The job failed :(',
  progress: 0,
  links: [],
  request: 'http://example.com/harmony?request=woody2',
  isAsync: false,
  numInputGranules: 12615,
});

const buzzJob1 = buildJob({
  username: 'buzz',
  status: JobStatus.RUNNING,
  message: 'In progress',
  progress: 30,
  links: [],
  request: 'http://example.com/harmony?request=buzz1&turbo=true',
  isAsync: true,
  numInputGranules: 10,
});

const sidJob1 = buildJob({
  username: 'sid',
  status: JobStatus.RUNNING_WITH_ERRORS,
});

const sidJob2 = buildJob({
  username: 'sid',
  status: JobStatus.COMPLETE_WITH_ERRORS,
});

const sidJob3 = buildJob({
  username: 'sid',
  status: JobStatus.PAUSED,
});

const sidJob4 = buildJob({
  username: 'sid',
  status: JobStatus.PREVIEWING,
});

describe('Workflow UI jobs route', function () {
  hookServersStartStop({ skipEarthdataLogin: false });

  before(async function () {
    await truncateAll();
  });

  after(async function () {
    await truncateAll();
  });

  describe('For a user who is not logged in', function () {
    before(async function () {
      this.res = await workflowUIJobs(this.frontend).redirects(0);
    });

    it('redirects to Earthdata Login', function () {
      expect(this.res.statusCode).to.equal(303);
      expect(this.res.headers.location).to.include(process.env.OAUTH_HOST);
    });

    it('sets the "redirect" cookie to the originally-requested resource', function () {
      expect(this.res.headers['set-cookie'][0]).to.include(encodeURIComponent('/workflow-ui'));
    });
  });

  describe('For a logged-in user', function () {
    hookTransaction();
    before(async function () {
      // Add all jobs to the database
      await woodyJob1.save(this.trx);
      await woodyJob2.save(this.trx);
      await woodySyncJob.save(this.trx);
      await buzzJob1.save(this.trx);
      await sidJob1.save(this.trx);
      await sidJob2.save(this.trx);
      await sidJob3.save(this.trx);
      await sidJob4.save(this.trx);
      this.trx.commit();
    });

    describe('When including a trailing slash on the user route /workflow-ui/', function () {
      before(async function () {
        this.res = await request(this.frontend).get('/workflow-ui/').use(auth({ username: 'andy' })).redirects(0);
      });

      it('redirects to the /workflow-ui page without a trailing slash', function () {
        expect(this.res.statusCode).to.equal(301);
        expect(this.res.headers.location).to.match(/.*\/workflow-ui$/);
      });
    });

    describe('who has no jobs', function () {
      hookWorkflowUIJobs({ username: 'andy' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an empty jobs table', function () {
        expect(this.res.text).to.not.contain('job-table-row');
      });
    });

    describe('who has jobs', function () {
      hookWorkflowUIJobs({ username: 'woody' });
      it('returns an HTTP success response', function () {
        expect(this.res.statusCode).to.equal(200);
      });

      it('returns an HTML table of info regarding the user\'s jobs', function () {
        const listing = this.res.text;
        [woodyJob1.request, woodyJob2.request, woodySyncJob.request]
          .forEach((req) => expect(listing).to.contain(mustache.render('{{req}}', { req })));
        expect((listing.match(/job-table-row/g) || []).length).to.equal(3);
      });

      it('does not return jobs for other users', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain(mustache.render('{{req}}', { req: buzzJob1.request }));
      });
    });

    describe('who has 3 jobs and asks for page 1, with a limit of 1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1 });
      it('returns a link to the next page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=2', 'next'));
      });
      it('returns a disabled link to the previous page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'previous', false));
      });
      it('returns a disabled link to the first page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'first', false));
      });it('returns a link to the last page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=3', 'last'));
      });
      it('returns only one job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who asks for page 1, with a limit of 1, descending', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, sortGranules: 'desc' });
      it('returns the largest job', function () {
        const listing = this.res.text;
        expect(listing).to.contain('89723');
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who asks for page 1, with a limit of 1, ascending', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, sortGranules: 'asc' });
      it('returns the smallest job', function () {
        const listing = this.res.text;
        expect(listing).to.contain('12615');
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who asks for more than env.maxPageSize jobs', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: env.maxPageSize + 999 });
      it('returns all of the users jobs without error', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(3);
      });
    });

    describe('who has 3 jobs and asks for page 2, with a limit of 1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, page: 2 });
      it('returns a link to the next and previous page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=1', 'previous'));
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=3', 'next'));
      });
      it('returns a disabled link to the first page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'first', false));
      });it('returns a disabled link to the last page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'last', false));
      });
      it('returns only one job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who has 3 jobs and asks for page 3, with a limit of 1', function () {
      hookWorkflowUIJobs({ username: 'woody', limit: 1, page: 3 });
      it('returns a disabled link to the next page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'next', false));
      });
      it('returns a link to the previous page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=2', 'previous'));
      });
      it('returns a link to the first page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('/workflow-ui?limit=1&page=1', 'first'));
      });
      it('returns a disabled link to the last page', function () {
        const listing = this.res.text;
        expect(listing).to.contain(renderNavLink('', 'last', false));
      });
      it('returns only one job', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
      });
    });

    describe('who filters by status IN [failed]', function () {
      hookWorkflowUIJobs({ username: 'woody', tableFilter: '[{"value":"status: failed","dbValue":"failed","field":"status"}]' });
      it('returns only failed jobs', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does not have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.not.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('who filters by status IN [failed, successful]', function () {
      const tableFilter = '[{"value":"status: failed","dbValue":"failed","field":"status"},{"value":"status: successful","dbValue":"successful","field":"status"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowStatus: '', tableFilter });
      it('returns failed and successful jobs', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(2);
        expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does not have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('who filters by an invalid status (working)', function () {
      hookWorkflowUIJobs({ username: 'woody', tableFilter: '[{"value":"status: working","dbValue":"working","field":"status"}, {"value":"status: running","dbValue":"running","field":"status"}]' });
      it('ignores the invalid status', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain('status: working');
        expect(listing).to.contain('status: running');
      });
    });

    describe('who filters by an invalid username (jo)', function () {
      hookAdminWorkflowUIJobs({ username: 'adam', tableFilter: '[{"value":"user: jo"}, {"value":"user: woody"}]' });
      it('ignores the invalid username', function () {
        const listing = this.res.text;
        expect(listing).to.not.contain('user: jo');
        expect(listing).to.contain('user: woody');
      });
    });

    describe('who filters by status NOT IN [failed, successful]', function () {
      const tableFilter = '[{"value":"status: failed","dbValue":"failed","field":"status"},{"value":"status: successful","dbValue":"successful","field":"status"}]';
      hookWorkflowUIJobs({ username: 'woody', disallowStatus: 'on', tableFilter });
      it('returns all jobs that are not failed or successful', function () {
        const listing = this.res.text;
        expect((listing.match(/job-table-row/g) || []).length).to.equal(1);
        expect(listing).to.not.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
        expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
        expect(listing).to.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
      });
      it('does have disallowStatus HTML checked', function () {
        const listing = this.res.text;
        expect((listing.match(/<input (?=.*name="disallowStatus")(?=.*checked).*>/g) || []).length).to.equal(1);
      });
      it('has the appropriate status options selected', function () {
        const listing = this.res.text;
        expect(listing).to.contain('status: failed');
        expect(listing).to.contain('status: successful');
        expect(listing).to.not.contain('status: running');
      });
    });

    describe('when accessing the admin endpoint', function () {
      describe('when the user is part of the admin group', function () {
        describe('When including a trailing slash on the admin route admin/workflow-ui/', function () {
          before(async function () {
            this.res = await request(this.frontend).get('/admin/workflow-ui/').use(auth({ username: 'adam' })).redirects(0);
          });

          it('redirects to the /admin/workflow-ui page without a trailing slash', function () {
            expect(this.res.statusCode).to.equal(301);
            expect(this.res.headers.location).to.match(/.*\/admin\/workflow-ui$/);
          });
        });

        hookAdminWorkflowUIJobs({ username: 'adam', limit: 100 });
        it('returns jobs for all users', async function () {
          const listing = this.res.text;
          [woodyJob1.request, woodyJob2.request, woodySyncJob.request, buzzJob1.request]
            .forEach((req) => expect(listing).to.contain(mustache.render('{{req}}', { req })));
          expect((listing.match(/job-table-row/g) || []).length).to.equal(8);
        });

        it('shows the users that submitted those jobs', async function () {
          const listing = this.res.text;
          expect(listing).to.contain('<td>woody</td>');
          expect(listing).to.contain('<td>buzz</td>');
        });
      });

      describe('when the admin filters the jobs by user IN [woody]', function () {
        hookAdminWorkflowUIJobs({ username: 'adam', tableFilter: '[{"value":"user: woody"}]' });
        it('only contains jobs submitted by woody', async function () {
          const listing = this.res.text;
          expect(listing).to.contain('<td>woody</td>');
          expect(listing).to.not.contain('<td>buzz</td>');
        });
      });

      describe('when the admin filters the jobs by user NOT IN [woody]', function () {
        hookAdminWorkflowUIJobs({ username: 'adam', tableFilter: '[{"value":"user: woody"}]', disallowUser: 'on' });
        it('does not contain jobs submitted by woody', async function () {
          const listing = this.res.text;
          expect(listing).to.not.contain('<td>woody</td>');
          expect(listing).to.contain('<td>buzz</td>');
        });
      });

      describe('when the admin filters by status IN [running_with_errors, complete_with_errors, paused, previewing]', function () {
        const tableFilter = '[{"value":"status: running with errors","dbValue":"running_with_errors","field":"status"},' +
        '{"value":"status: complete with errors","dbValue":"complete_with_errors","field":"status"},' +
        '{"value":"status: paused","dbValue":"paused","field":"status"},' +
        '{"value":"status: previewing","dbValue":"previewing","field":"status"}]';
        hookAdminWorkflowUIJobs({ username: 'adam', disallowStatus: '', tableFilter });
        it('returns jobs with the aforementioned statuses', function () {
          const listing = this.res.text;
          expect((listing.match(/job-table-row/g) || []).length).to.equal(4);
          expect(listing).to.contain(`<span class="badge bg-warning">${JobStatus.RUNNING_WITH_ERRORS.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-success">${JobStatus.COMPLETE_WITH_ERRORS.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-warning">${JobStatus.PAUSED.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-info">${JobStatus.PREVIEWING.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
        });
        it('does not have disallowStatus HTML checked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowStatus")(?!.*checked).*>/g) || []).length).to.equal(1);
        });
        it('has the appropriate status options selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain('status: running with errors');
          expect(listing).to.contain('status: complete with errors');
          expect(listing).to.contain('status: paused');
          expect(listing).to.contain('status: previewing');
          expect(listing).to.not.contain('status: failed');
          expect(listing).to.not.contain('status: successful');
        });
      });

      describe('when the admin filters by status NOT IN [running_with_errors, complete_with_errors, paused, previewing]', function () {
        const tableFilter = '[{"value":"status: running with errors","dbValue":"running_with_errors","field":"status"},' +
        '{"value":"status: complete with errors","dbValue":"complete_with_errors","field":"status"},' +
        '{"value":"status: paused","dbValue":"paused","field":"status"},' +
        '{"value":"status: previewing","dbValue":"previewing","field":"status"}]';
        hookAdminWorkflowUIJobs({ username: 'adam', disallowStatus: 'on', tableFilter });
        it('returns jobs without the aforementioned statuses', function () {
          const listing = this.res.text;
          expect((listing.match(/job-table-row/g) || []).length).to.equal(4);
          expect(listing).to.not.contain(`<span class="badge bg-warning">${JobStatus.RUNNING_WITH_ERRORS.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-success">${JobStatus.COMPLETE_WITH_ERRORS.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-warning">${JobStatus.PAUSED.valueOf()}</span>`);
          expect(listing).to.not.contain(`<span class="badge bg-info">${JobStatus.PREVIEWING.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-danger">${JobStatus.FAILED.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-success">${JobStatus.SUCCESSFUL.valueOf()}</span>`);
          expect(listing).to.contain(`<span class="badge bg-info">${JobStatus.RUNNING.valueOf()}</span>`);
        });
        it('does have disallowStatus HTML checked', function () {
          const listing = this.res.text;
          expect((listing.match(/<input (?=.*name="disallowStatus")(?=.*checked).*>/g) || []).length).to.equal(1);
        });
        it('has the appropriate status options selected', function () {
          const listing = this.res.text;
          expect(listing).to.contain('status: running with errors');
          expect(listing).to.contain('status: complete with errors');
          expect(listing).to.contain('status: paused');
          expect(listing).to.contain('status: previewing');
          expect(listing).to.not.contain('status: failed');
          expect(listing).to.not.contain('status: successful');
        });
      });

      describe('when the user is not part of the admin group', function () {
        hookAdminWorkflowUIJobs({ username: 'eve' });
        it('returns an error', function () {
          expect(this.res.statusCode).to.equal(403);
          expect(this.res.text).to.include('You are not permitted to access this resource');
        });
      });
    });
  });
});
