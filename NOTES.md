Data Tooling - Coding Assignment

## Time budget tracking:
- Start: ~9:45AM
- Directory and project bootstrapping: 5 minutes
- Going through requirements, doing inventory of the open-tomato package status, and writing down requirements notes: 30~35min
- Setting up dependencies and running a blank service: 

Requirements:
- Service exposing at least 2 resources (companies and filings) to provide listings of companies submissions and a summary. 
  - Use: `@open-tomato/service*` via the shell implementation `@open-tomato/template-service` to bootstrap the work directory quickly 
  - Additional endpoints from the expressed in the requirements will include a `[GET]` returning all known companies for easy switching.
  - format of the resource URIs (draft): 
    - `[GET] /companies/{:ticker}/filings`: Paginated, filterable.
    - `[GET] /filings/summary`: expects an array of companies. 
    - `[GET] /companies`: optional, returns all companies to simplify company switching on the client.
    - `[GET] /companies/{:ticker}` or `[POST] /search/`: Proposed, search first against cached company list or validation of criteria before hitting SEC services.
  - To check and define:
    - Can the documents be fetched directly or do I need to handle a special method to download and caching on our end first?
    - Do I require validation on any of the SEC resources?
    - DB: initial thought is that it doesn't seem to be required, but I still need to look into the SEC data, SQLite is already available in bun and won't be an issue, but I'd use drizzle for migrations if data gets complex so moving to something like pg won't be too much of a rework.  
- Front end:
  - Simple datagrid with handful of controls, how they pick and switch between companies is not defined explicitly. 
    - For results control: implement `Toolbar` it has all the requirements and a bit more.
    - For datagrid use `Table`
  - For company switching I'll use either:
    - `ContextSwitcher` with known companies on top of the sidebar.
    - A new view with a grid with `RowStatCards` and include some of the available data in there already.
    - Top bar `CommandPallette`, if it's flexible enough to be reused to search against SEC or a pre-set of companies, fallback to simple `Select` otherwise.
  - Summary: Pending to see what data is available, but I can leverage several visualization components from `@open-tomato/charts`
  - To check and define:
    - Include the app shell or leave the views as a single screen with the listings, the company selector on top and the documents show on a `Modal` or a `Drawer`. Decision: Leave the appShell, it's a bit above the top for the test requirement but it's already done and it doesn't differ of something that a prompt will do in a bit, except is already done and tested, slightly more reliable I guess.
    - If there's time, add the search company page with the `RowSelector` component to turn which companies to follow, these will show up in the company switching selector. q: Would make sense if UX wise this action might already trigger an ingest into the cache for their fillings?

- Extras included in the template:
  - `@open-tomato/service-mcp` uses the same handlers and schemas as the ones used for the APIs so setting it up is very cheap. 
  - Open Notebook support. 
    - The MCP service has the Open Notebook driver defined already so wiring it to a notebook instance (can run on a docker) would be couple of lines and I will get it for free basically.
    - If document handling and caching becomes an issue, the notebook could be serve as storage, not ideal, but it will do the trick right out of the box and provide additional insights and search functionality. 

check [10:35]. Done with planning and bootstrapping, starting with some surveying. 
- Data extraction first pass (human):
  - given example: `data.sec.gov/submissions/CIK##########.json`
  - Get tech summary translation from legal framing of automated data extraction [here](https://www.sec.gov/about/privacy-information) 
  - cik is the raw CIK, cik10 will be the cik with leading `0`s up to 10 digits, both formats are used. Use the json list with companies for seeding the company list. 
  - archve: https://www.sec.gov/Archives/edgar/data/$cik/index.json
  - navigation pattern:
  - company data:
  - fillings: https://data.sec.gov/api/xbrl/companyconcept/CIK0001045810/us-gaap/AccountsPayableCurrent.json
  ```
        {
        "end": "2009-01-25",
        "val": 218864000,
        "accn": "0001045810-09-000024",
        "fy": 2009,
        "fp": "Q2",
        "form": "10-Q",
        "filed": "2009-08-20"
      },
    ```
  - company archive  https://www.sec.gov/Archives/edgar/data/1045810/000104581026000024/ => xml(`FilingSummary.MyReports.InputFiles[doctype='8-K']` = `nvda-20260302.htm`)
Check [11.37]. -- done reviewing data structures and api. First query trials
[!note] `@open-tomato/ui` was using our local private registry, ensure the last published version is updated in https://registry.npmjs.org/ after the credentials rotation. 

