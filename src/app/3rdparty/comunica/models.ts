import { Observable, Subscription } from "rxjs";

export enum ResponseType {
    ACCUMULATED = "accumulated",
    SINGLE = "single"
}
  
export enum Serialization {
    "JSON-LD" = "application/ld+json",
    Turtle = "text/turtle",
    N3 = "text/n3",
    NTriples = "application/n-triples",
    NQuads = "application/n-quads",
    TriG = "application/trig",
    RDFXML = "application/rdf+xml"
}

export class QueryResult{
    running: boolean = false;
    complete: boolean = false;
    type: string = "SELECT";
    result: any[] = [];
    querySubscription$?: Observable<any>;
}

export class UpdateResult {
    added: number = 0;
    deleted: number = 0;
    message: string = "Successfully updated store";
}

export class Source {

    id: string = "";
    type: SourceType = SourceType.SPARQL;
    value: any;
    primary: boolean = false;  // Update queries are executed on primary store
    active?: boolean = true;   // Queries are only executed on active stores

    constructor(value: any, type: SourceType = SourceType.SPARQL, id?: string){
        if(id != undefined) this.id = id;
        this.value = typeof value == "string" ? value.trim() : value;
        this.type = type;
    }

    makePrimary(){
        this.primary = true;
    }

    makeSecondary(){
        this.primary = false;
    }

    activate(){
        this.active = true;
    }

    deactivate(){
        this.active = false;
    }

}

export enum SourceType {
    Hypermedia = "hypermedia",
    File = "file",
    HDT = "hdtFile",
    OSTRICH = "ostrichFile",
    RDFJS = "rdfjsSource",
    SPARQL = "sparql"
}