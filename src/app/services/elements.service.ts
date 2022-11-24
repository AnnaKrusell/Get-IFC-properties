import { Injectable } from '@angular/core';
import { ComunicaService } from 'src/app/3rdparty/comunica/comunica.service';
import { lastValueFrom } from 'rxjs';
import { Properties } from '../models';
import { UtilsService } from './utils.service';

@Injectable({
  providedIn: 'root',
})
export class ElementsService {
  public queryResult?: any;
  public queryComplete: boolean = false;

  constructor(
    private _comunica: ComunicaService,
  ) {}

  async getTypes(): Promise<Properties[]> {
    const query = `PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    SELECT DISTINCT ?type
    WHERE { 
      ?inst a ?type .
    }
    `;

    // const query = `PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    // SELECT DISTINCT ?type
    // WHERE { 
    //   ?inst a ?type .
    //   ?inst ?Property ?Value .
    //   ?Property <https://example.com/belongsToPset> ?pSet .
    // }
    // `;
    const types = await lastValueFrom(this._comunica.selectQuery(query));
    return types.map((item: any) => {
      const typeWithURI = item.type.value;

      var type = typeWithURI.split('#').pop();

      const checked: boolean = false;

      return { type, typeWithURI, checked };
    });
  }

 
  async getProps(TypeName: any, NameWithURI: any): Promise<Properties[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX ex: <https://example.com/>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    SELECT DISTINCT  ?pSet ?Property ?Value ?inst
    WHERE { 
      ?inst a <${NameWithURI}> .
      ?inst ?Property ?Value .
      ?Property <https://example.com/belongsToPset> ?pSet
    } ORDER BY ?pSet 
    `;

    const properties = await lastValueFrom(this._comunica.selectQuery(query));
    return properties.map((item: any) => {
      const propertyWithURI = item.Property.value;
      const value = item.Value.value;
      const pSetWithURI = item.pSet.value;
      const instGUIDWithURI = item.inst.value;

      var pSet = pSetWithURI.split('/').pop();
      var property = propertyWithURI.split('/').pop();
      var instGUID = instGUIDWithURI.split('/').pop();

      return { pSet, property, value, TypeName, instGUID };
    });
  }

  async getRoomTable(): Promise<Properties[]> {
    const query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX kga: <https://w3id.org/kobl/geometry-analysis#>
    PREFIX ifc: <http://ifcowl.openbimstandards.org/IFC2X3_Final#>
    PREFIX bot: <https://w3id.org/bot#>
    PREFIX kbt: <https://w3id.org/kobl/building-topology#>
    PREFIX kg: <https://w3id.org/kobl/geometry#>
    SELECT *
    WHERE{
        ?space a bot:Space .
      OPTIONAL { ?space <https://example.com/roomNumber> ?spaceName}
      OPTIONAL { ?space rdfs:label ?spaceLabel }
      OPTIONAL { ?space <https://web-bim/resources/levelConstraints> ?spaceLevel}
      OPTIONAL { ?space <https://web-bim/resources/areaDimensions> ?area}  
      OPTIONAL { ?space <https://web-bim/resources/roomCategoryIdentityData> ?category}    
                     
  } ORDER BY ?spaceLabel
    `;

    const properties = await lastValueFrom(this._comunica.selectQuery(query));
    return properties.map((item: any) => {
      const space = item.space.value;

      var spaceName : any[] = [];
      var spaceLabel : any[] = [];
      var spaceLevel : any[] = [];
      var spaceArea : any[] = [];
      var spaceCategory : any[] = [];
      
      if (item.spaceName) {
        spaceName = item.spaceName.value;
      }
      if (item.spaceLabel) {
        spaceLabel = item.spaceLabel.value;
      }
      if (item.spaceLevel) {
        spaceLevel = item.spaceLevel.value;
      }
      if (item.area) {
        spaceArea = item.area.value;
      }
      if (item.category) {
        spaceCategory = item.category.value;
      }

      return { space, spaceName, spaceLabel, spaceLevel, spaceArea, spaceCategory };
    });
  }


}
